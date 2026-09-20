CREATE TABLE "sso_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"display_name" text DEFAULT 'Single sign-on' NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"default_role_id" integer,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"require_verified_email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "sso_connections_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "sso_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"domain" text NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sso_domains_tenant_domain_uq" UNIQUE("tenant_id","domain")
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"connection_id" integer NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"created_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	CONSTRAINT "user_identities_connection_subject_uq" UNIQUE("connection_id","subject")
);
--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_connection_id_sso_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."sso_connections"("id") ON DELETE cascade ON UPDATE no action;