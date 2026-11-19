// Inline Jenkins Pipeline helper. Merge this call into the existing top-level post block:
// post { cleanup { script { notifyDeploy('https://<space>/api/hooks', '<success-secret-id>',
//   '<failure-secret-id>', params.DEPLOY, '<last-verified-deployed-sha>') } } }
// Run on a trusted Linux agent with Git, curl and jq.

def notifyDeploy(String endpoint, String successId, String failureId, boolean deployed, String seedSha) {
    def result = currentBuild.currentResult
    def success = result == 'SUCCESS'
    try {
        def base = ''
        def head = ''
        if (success) {
            base = currentBuild.previousSuccessfulBuild?.buildVariables?.get('GG_DEPLOYED_SHA') ?: seedSha
            head = deployed ? (env.SOURCE_COMMIT ?: '') : ''
            // A green CI-only build must not become the next deployment baseline.
            env.GG_DEPLOYED_SHA = head ?: base
            if (!deployed) return
        }
        withCredentials([string(credentialsId: success ? successId : failureId, variable: 'GG_HOOK_TOKEN')]) {
            withEnv(["GG_HOOK_ENDPOINT=${endpoint}", "GG_DEPLOY_RESULT=${result}",
                "GG_DEPLOY_BASE=${base}", "GG_DEPLOY_HEAD=${head}",
                "GG_DEPLOY_STARTED_MS=${currentBuild.startTimeInMillis}"]) {
                try {
                    sh(label: 'Notify Gonggong', script: deployWebhookScript())
                } finally {
                    def log = ".gg-deploy-notification/${env.BUILD_NUMBER}/git-log.txt"
                    if (success && fileExists(log)) archiveArtifacts artifacts: log
                }
            }
        }
    } catch (Exception ignored) {
        echo 'Gonggong: notification not confirmed; check the notification step and credentials.'
    }
}

String deployWebhookScript() {
    return '''#!/usr/bin/env bash
set -euo pipefail
umask 077
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT

if [[ ! $GG_HOOK_TOKEN =~ ^[a-zA-Z0-9_-]+$ || $GG_HOOK_ENDPOINT != https://*/api/hooks ]]; then
    echo 'Gonggong: invalid webhook configuration.'
    exit 1
fi

mention=false
headline='共工部署成功'
if [[ $GG_DEPLOY_RESULT != SUCCESS ]]; then
    mention=true
    headline='共工部署未成功'
fi

: > "$temp/log"
if $mention && [[ $GG_DEPLOY_STARTED_MS =~ ^[0-9]{4,}$ && ! -L source && ! -L source/ci-results ]] &&
    touch -d "@${GG_DEPLOY_STARTED_MS:0:-3}.${GG_DEPLOY_STARTED_MS: -3}" "$temp/build-start"; then
    # A reused workspace may still contain logs from a previous build.
    if ! (
        for log in source/ci-results/{typecheck,lint,tooling,rust,build,packages}.log; do
            [[ -f "$log" && ! -L "$log" && "$log" -nt "$temp/build-start" ]] || continue
            tail -c 65536 -- "$log" | tail -n 400
        done
        :
    ) |
        jq -Rs -r '
            gsub("\\u001b[[][0-9;]*[A-Za-z]"; "") | split("\\n")
            | map(select(test("FAIL|ERROR|Error:|Exception|timeout|timed out|Finished:"; "i")))
            | map(select(contains(env.GG_HOOK_TOKEN) | not))
            | map(select(test("authorization|bearer|password|secret|token|credential|cookie|private[ _-]?key|api[ _-]?key|https?://|-----BEGIN"; "i") | not))
            | map(gsub("[A-Za-z0-9+/=_-]{24,}"; "[redacted]") | .[0:360])
            | .[-120:] | join("\\n")' > "$temp/log"; then
        : > "$temp/log"
    fi
fi

summary=''
attachment_name='jenkins-diagnostics.log'
archive_path=''
if ! $mention; then
    attachment_name=''
    base=${GG_DEPLOY_BASE:-}
    head=${GG_DEPLOY_HEAD:-}
    if [[ $base =~ ^[0-9a-f]{40,64}$ && $head =~ ^[0-9a-f]{40,64}$ ]] &&
        git -C source log --no-color --no-decorate --format='%H  %an  %aI%n%B' "$base..$head" -- > "$temp/git-log"; then
        count=$(git -C source rev-list --count "$base..$head" --)
        summary="部署范围：${base:0:12} → ${head:0:12} · ${count} 个提交"
        bytes=$(wc -c < "$temp/git-log")
        if (( count == 0 )); then
            summary="${summary}（无新增提交）"
        elif (( bytes <= 10000 )); then
            printf '\\n\\n%s\\n%s' "$summary" "$(cat "$temp/git-log")" > "$temp/summary"
            summary=''
        else
            if (( bytes <= 262144 )); then
                attachment_name='git-log.txt'
                cp "$temp/git-log" "$temp/log"
                summary="${summary}。完整提交记录见附件。"
            else
                archive_path=".gg-deploy-notification/$BUILD_NUMBER/git-log.txt"
                if mkdir -p -- "${archive_path%/*}" && cp -- "$temp/git-log" "$archive_path"; then
                    summary="${summary}。完整提交记录见 Jenkins 构建归档。"
                else
                    archive_path=''
                    summary="${summary}。完整提交记录归档失败，请查看 Jenkins。"
                fi
            fi
        fi
    else
        summary='无法核对上次成功部署与本次部署的提交范围，未生成提交清单。'
    fi
fi
if [[ ! -f "$temp/summary" ]]; then
    if [[ -n $summary ]]; then printf '\\n\\n%s' "$summary" > "$temp/summary"; else : > "$temp/summary"; fi
fi

dedupe=$(printf '%s\\n' "$BUILD_URL" | sha256sum)
jq -n --arg headline "$headline" --arg result "$GG_DEPLOY_RESULT" \\
    --arg job "$JOB_NAME" --arg build "$BUILD_NUMBER" --arg sha "${GG_DEPLOY_HEAD:-${SOURCE_COMMIT:-${GIT_COMMIT:-}}}" \\
    --arg url "${BUILD_URL%/}/console" --arg key "jenkins:${dedupe%% *}" --arg name "$attachment_name" \\
    --arg archive "$archive_path" --rawfile summary "$temp/summary" \\
    --argjson mention "$mention" --rawfile log "$temp/log" '
    {text: ($headline + "（" + $result + "）\\n任务：" + $job[0:400] + " #" + $build
        + (if $sha == "" then "" else "\\n提交：" + $sha[0:12] end)
        + $summary
        + "\\n\\n控制台：" + $url
        + (if $archive == "" then "" else "\\n完整日志：" + ($url | rtrimstr("/console")) + "/artifact/" + $archive end)),
      card: {tone: (if $mention then "failure" else "success" end), url: $url},
      mention: $mention, dedupeKey: $key}
    + (if $name != "" and ($log | test("[^[:space:]]")) then
        {attachment: {name: $name, content: $log}}
      else {} end)
    ' > "$temp/request"

printf 'header = "Authorization: Bearer %s"\\n' "$GG_HOOK_TOKEN" |
    curl -q --config - --proto '=https' --connect-timeout 3 --max-time 8 \\
        --retry 2 --retry-max-time 20 --retry-connrefused --fail --silent --show-error \\
        -H 'Content-Type: application/json' --data-binary "@$temp/request" \\
        --output "$temp/response" "$GG_HOOK_ENDPOINT"

jq -e -r --argjson mention "$mention" '
    if (.messageId | type) != "string" then error("missing webhook delivery receipt")
    elif $mention and (.runId | type) != "string" then
        if .skipped == "busy" or .skipped == "unavailable" then
            "Gonggong: message delivered; bot not started (" + .skipped + ")."
        else "Gonggong: message delivered; bot start not confirmed." end
    elif $mention then "Gonggong: message delivered and bot run confirmed."
    else "Gonggong: message delivered." end
    ' "$temp/response"
'''
}
