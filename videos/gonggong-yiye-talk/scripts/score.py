# Procedural ambient bed + cut SFX. Usage: /usr/bin/python3 scripts/score.py -> assets/audio/bed.wav, assets/audio/sfx.wav
import re, json, wave, numpy as np
SR = 44100; LEN = 192.821; N = int(SR * LEN)
BPM = 92; BEAT = 60 / BPM; BAR = 4 * BEAT
rng = np.random.default_rng(7)
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
starts = [float(x) for x in re.findall(r'id="s\d\d"[^>]*data-start="([\d.]+)"', open('index.html').read())]
PIVOT, END = 84.6, 191.2

def lp(x, a):
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s += a * (x[i] - s); y[i] = s
    return y

def place(buf, t, sig, g=1.0):
    i = int(t * SR); j = min(N, i + len(sig))
    if i < N: buf[i:j] += sig[: j - i] * g

bed = np.zeros(N); sfx = np.zeros(N)
chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]]  # Am7 Fmaj7 Cmaj7 G(add)
nb = int(LEN / BAR) + 1
for b in range(nb):
    t0 = b * BAR; d = BAR + 0.6; tt = np.arange(int(d * SR)) / SR
    e = np.minimum(1, tt / 0.5) * np.minimum(1, (d - tt) / 0.6)
    pad = sum(np.sin(2 * np.pi * hz(m) * tt * k) / k for m in chords[b % 4] for k in (1, 1.003, 0.997)) / 9
    place(bed, t0, pad * e, 0.22)
    root = chords[b % 4][0] - 24
    for beat in (0, 2):
        bt = np.arange(int(0.5 * SR)) / SR
        kick = np.sin(2 * np.pi * (hz(root) * bt + 30 * (1 - np.exp(-25 * bt)) / 25)) * np.exp(-bt / 0.22)
        place(bed, t0 + beat * BEAT, kick, 0.35 if t0 >= PIVOT else 0.18)
    if t0 >= 16:
        for k in range(8):
            m = chords[b % 4][[0, 2, 1, 3, 2, 1, 3, 2][k]] + 12
            at = np.arange(int(0.45 * SR)) / SR
            pl = (np.sin(2 * np.pi * hz(m) * at) + 0.3 * np.sin(4 * np.pi * hz(m) * at)) * np.exp(-at / 0.14) * np.minimum(1, at / 0.004)
            place(bed, t0 + k * BEAT / 2, pl, 0.07 if t0 < PIVOT else 0.1)
    if t0 >= PIVOT:
        for k in range(8):
            ht = np.arange(int(0.06 * SR)) / SR
            h = np.diff(rng.standard_normal(len(ht) + 1)) * np.exp(-ht / 0.012)
            place(bed, t0 + k * BEAT / 2 + BEAT / 4, h, 0.03)
bed = lp(bed, 0.35)
tt = np.arange(N) / SR
fade = np.minimum(1, tt / 2.5) * np.clip((LEN - tt) / 3.0, 0, 1)
bed *= fade

for s in starts[1:]:
    wt = np.arange(int(0.35 * SR)) / SR
    sw = lp(rng.standard_normal(len(wt)), 0.08) * np.sin(np.pi * wt / 0.35) ** 2
    place(sfx, s - 0.18, sw, 0.5)
    bt = np.arange(int(0.12 * SR)) / SR
    place(sfx, s, np.sin(2 * np.pi * 1760 * bt) * np.exp(-bt / 0.03), 0.06)

def write(path, x, peak):
    x = x / (np.abs(x).max() + 1e-9) * peak
    st = np.repeat((x * 32767).astype(np.int16)[:, None], 2, axis=1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
write('assets/audio/bed.wav', bed, 0.5)
write('assets/audio/sfx.wav', sfx, 0.5)
print('ok', len(starts))
