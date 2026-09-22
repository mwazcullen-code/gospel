/*
# Create admin_emails table, email attachment storage bucket, and fix security issues

## What this migration does

1. **Creates the `admin_emails` table** — stores both inbound and outbound emails
   for the admin dashboard inbox. The application code already references this table
   but it was missing from the database.

2. **Creates the `admin-email-attachments` storage bucket** — used by the admin
   compose feature to upload file attachments.

3. **Tightens `blog_posts` RLS** — restricts INSERT, UPDATE, DELETE to authenticated
   (admin) users only. Previously anon could write/delete blog posts.

4. **Fixes the mutable `search_path` on `update_blog_posts_updated_at`** — recreates
   the function with `search_path = public` to resolve the security linter warning.

## New table: admin_emails
- `id` (uuid, primary key)
- `direction` (text: 'inbound' or 'outbound')
- `from_email`, `from_name`, `to_email`, `subject`
- `body_text`, `body_html` (nullable)
- `attachments` (jsonb, defaults to empty array)
- `status` (text: 'unread', 'read', 'sent', 'deleted')
- `in_reply_to` (uuid, nullable)
- `thread_id` (text, not null)
- `source`, `source_id` (nullable)
- `created_at` (timestamptz, defaults to now())

## Security changes
- RLS on `admin_emails`: SELECT/UPDATE/DELETE for authenticated only; INSERT for anon+authenticated.
- `blog_posts` write policies restricted to authenticated only.
- Storage bucket `admin-email-attachments` created as private with authenticated-only policies.
*/

-- ════════════════════════════════════════════════════════════
-- 1. Create admin_emails table
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction     text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email    text NOT NULL,
  from_name     text,
  to_email      text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  body_text     text,
  body_html     text,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'sent', 'deleted')),
  in_reply_to   uuid,
  thread_id     text NOT NULL DEFAULT gen_random_uuid()::text,
  source        text,
  source_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_emails_created_at ON admin_emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_emails_direction_status ON admin_emails (direction, status);
CREATE INDEX IF NOT EXISTS idx_admin_emails_thread_id ON admin_emails (thread_id);

ALTER TABLE admin_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_admin_emails" ON admin_emails;
DROP POLICY IF EXISTS "anon_insert_admin_emails" ON admin_emails;
DROP POLICY IF EXISTS "authenticated_update_admin_emails" ON admin_emails;
DROP POLICY IF EXISTS "authenticated_delete_admin_emails" ON admin_emails;

CREATE POLICY "authenticated_select_admin_emails"
ON admin_emails FOR SELECT
TO authenticated
USING (status <> 'deleted');

CREATE POLICY "anon_insert_admin_emails"
ON admin_emails FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_update_admin_emails"
ON admin_emails FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "authenticated_delete_admin_emails"
ON admin_emails FOR DELETE
TO authenticated
USING (true);

-- ════════════════════════════════════════════════════════════
-- 2. Tighten blog_posts RLS — prevent public write/delete
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anon_delete_blog_posts" ON blog_posts;
DROP POLICY IF EXISTS "anon_insert_blog_posts" ON blog_posts;
DROP POLICY IF EXISTS "anon_update_blog_posts" ON blog_posts;

DROP POLICY IF EXISTS "authenticated_insert_blog_posts" ON blog_posts;
DROP POLICY IF EXISTS "authenticated_update_blog_posts" ON blog_posts;
DROP POLICY IF EXISTS "authenticated_delete_blog_posts" ON blog_posts;

CREATE POLICY "authenticated_insert_blog_posts"
ON blog_posts FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "authenticated_update_blog_posts"
ON blog_posts FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "authenticated_delete_blog_posts"
ON blog_posts FOR DELETE
TO authenticated
USING (true);

-- ════════════════════════════════════════════════════════════
-- 3. Fix mutable search_path on update_blog_posts_updated_at
-- ════════════════════════════════════════════════════════════

-- Drop the existing trigger first, then the function, then recreate both
DROP TRIGGER IF EXISTS trg_blog_posts_updated_at ON blog_posts;
DROP TRIGGER IF EXISTS trigger_update_blog_posts_updated_at ON blog_posts;

DROP FUNCTION IF EXISTS public.update_blog_posts_updated_at() CASCADE;

CREATE OR REPLACE FUNCTION public.update_blog_posts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_blog_posts_updated_at();

-- ════════════════════════════════════════════════════════════
-- 4. Create admin-email-attachments storage bucket (private)
-- ════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-email-attachments', 'admin-email-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated_read_attachments" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_upload_attachments" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_delete_attachments" ON storage.objects;

CREATE POLICY "authenticated_read_attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'admin-email-attachments');

CREATE POLICY "authenticated_upload_attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'admin-email-attachments');

CREATE POLICY "authenticated_delete_attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'admin-email-attachments');
