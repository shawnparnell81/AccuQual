CREATE TABLE "department_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"department_name" text NOT NULL,
	"module_name" text NOT NULL,
	"access_level" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permission_role_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"module_name" text NOT NULL,
	"access_level" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "permission_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"role_name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_permission_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "department_permissions" ADD CONSTRAINT "department_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role_modules" ADD CONSTRAINT "permission_role_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_role_modules" ADD CONSTRAINT "permission_role_modules_role_id_permission_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."permission_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_roles" ADD CONSTRAINT "permission_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_roles" ADD CONSTRAINT "user_permission_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_roles" ADD CONSTRAINT "user_permission_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_roles" ADD CONSTRAINT "user_permission_roles_role_id_permission_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."permission_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_permissions_tenant_dept_module_idx" ON "department_permissions" USING btree ("tenant_id","department_name","module_name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_role_modules_tenant_role_module_idx" ON "permission_role_modules" USING btree ("tenant_id","role_id","module_name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_roles_tenant_name_idx" ON "permission_roles" USING btree ("tenant_id","role_name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_roles_tenant_user_role_idx" ON "user_permission_roles" USING btree ("tenant_id","user_id","role_id");