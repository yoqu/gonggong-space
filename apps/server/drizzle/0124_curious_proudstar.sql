CREATE TABLE "artifact_members" (
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_members_artifact_id_user_id_pk" PRIMARY KEY("artifact_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "artifact_members" ADD CONSTRAINT "artifact_members_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_members" ADD CONSTRAINT "artifact_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_members" ADD CONSTRAINT "artifact_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_members_user" ON "artifact_members" USING btree ("user_id");