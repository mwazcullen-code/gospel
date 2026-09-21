import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { Resend } from "npm:resend@6.25.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FROM_EMAIL = "In Him Daily <hello@inhimdaily.org>";
const RECEIVING_EMAIL = Deno.env.get("CONTACT_RECEIVING_EMAIL") ?? "hello@inhimdaily.org";

async function getConfig(supabase: ReturnType<typeof createClient>, key: string): Promise<string> {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return "";
  return data.value as string;
}

interface RequestBody {
  name: string;
  email: string;
  subject: string;
  message: string;
  country?: string;
  city_region?: string;
  website?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function buildTeamNotificationHtml(data: RequestBody): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0E2035;font-family:Georgia,'Times New Roman',serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0E2035;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#13294a;border:1px solid rgba(228,184,106,0.2);border-radius:16px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:40px 40px 24px;background:linear-gradient(180deg,rgba(201,152,58,0.08) 0%,transparent 100%);">
              <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#C9983A;font-weight:bold;margin:0 0 12px 0;">New Contact Form Submission</p>
              <h1 style="font-size:24px;color:#ffffff;margin:0;font-weight:bold;">${escapeHtml(data.subject)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <tr><td style="padding:24px 28px;">
                  <p style="font-size:13px;color:#C9983A;font-weight:bold;margin:0 0 4px 0;">From</p>
                  <p style="font-size:16px;color:rgba(255,255,255,0.9);margin:0 0 16px 0;">${escapeHtml(data.name)} &lt;${escapeHtml(data.email)}&gt;</p>
                  ${data.country ? `<p style="font-size:13px;color:#C9983A;font-weight:bold;margin:0 0 4px 0;">Location</p><p style="font-size:15px;color:rgba(255,255,255,0.7);margin:0 0 16px 0;">${escapeHtml(data.country)}${data.city_region ? ", " + escapeHtml(data.city_region) : ""}</p>` : ""}
                  <p style="font-size:13px;color:#C9983A;font-weight:bold;margin:0 0 4px 0;">Message</p>
                  <p style="font-size:15px;color:rgba(255,255,255,0.75);line-height:1.7;margin:0;white-space:pre-wrap;">${escapeHtml(data.message)}</p>
                </td></tr>
              </table>
              <p style="font-size:13px;color:rgba(255,255,255,0.4);margin:20px 0 0 0;">Reply directly to this email to respond to ${escapeHtml(data.name)}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildAutoReplyHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0E2035;font-family:Georgia,'Times New Roman',serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0E2035;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#13294a;border:1px solid rgba(228,184,106,0.2);border-radius:16px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:48px 40px 32px;background:linear-gradient(180deg,rgba(201,152,58,0.08) 0%,transparent 100%);">
              <p style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#C9983A;font-weight:bold;margin:0 0 16px 0;">In Him Daily</p>
              <h1 style="font-size:26px;color:#ffffff;margin:0 0 8px 0;font-weight:bold;">We Received Your Message</h1>
              <p style="font-size:16px;color:rgba(255,255,255,0.6);margin:0;font-style:italic;">Every generation. Every day. In Him.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 24px 40px;">
              <p style="font-size:17px;color:rgba(255,255,255,0.85);line-height:1.6;margin:0 0 16px 0;">Dear ${escapeHtml(name)},</p>
              <p style="font-size:16px;color:rgba(255,255,255,0.7);line-height:1.7;margin:0 0 16px 0;">
                Thank you for reaching out to In Him Daily. We have received your message and will get back to you within 24–48 hours.
              </p>
              <p style="font-size:16px;color:rgba(255,255,255,0.7);line-height:1.7;margin:0;">
                In the meantime, we'd love for you to explore our devotionals, read a free sample, or join one of our prayer communities.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 40px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color:#C9983A;border-radius:30px;padding:16px 40px;">
                    <a href="https://inhimdaily.org/devotionals" style="font-size:15px;color:#0E2035;text-decoration:none;font-weight:bold;">Read Today's Devotional</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 40px 40px;">
              <div style="border-top:1px solid rgba(228,184,106,0.2);padding-top:24px;">
                <p style="font-size:22px;color:rgba(255,255,255,0.9);font-style:italic;line-height:1.4;margin:0 0 8px 0;">"Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up."</p>
                <p style="font-size:11px;color:#C9983A;font-weight:bold;letter-spacing:0.16em;text-transform:uppercase;margin:0;">Galatians 6:9</p>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 32px 40px;">
              <p style="font-size:12px;color:rgba(255,255,255,0.35);line-height:1.5;margin:0;">
                In Him Daily — a ministry of Epic True North<br/>
                <a href="https://inhimdaily.org" style="color:rgba(201,152,58,0.6);text-decoration:none;">inhimdaily.org</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();

    // Honeypot: bots fill hidden fields; humans don't
    if (body.website?.trim()) {
      return new Response(
        JSON.stringify({ success: true, message: "Your message has been received." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limiting
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!body.name?.trim() || !body.email?.trim() || !body.subject?.trim() || !body.message?.trim()) {
      return new Response(
        JSON.stringify({ error: "Name, email, subject, and message are all required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const name = body.name.trim().slice(0, 100);
    const subject = body.subject.trim().slice(0, 200);
    const message = body.message.trim().slice(0, 5000);
    const email = body.email.trim().slice(0, 200);

    const EMAIL_REGEX = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
    if (!EMAIL_REGEX.test(email)) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Save the contact message to the database
    const { error: dbError } = await supabase.from("contact_messages").insert({
      name,
      email,
      subject,
      message,
      country: body.country?.trim().slice(0, 100) || null,
      city_region: body.city_region?.trim().slice(0, 100) || null,
    });

    if (dbError) {
      console.error("Database error saving contact message:", dbError.message);
    }

    // 2. Send notification email to the team + auto-reply to the visitor
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? await getConfig(supabase, "RESEND_API_KEY");

    if (RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);

      // Notification to the team
      try {
        const { error: teamError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: RECEIVING_EMAIL,
          reply_to: email,
          subject: `[Contact Form] ${subject}`,
          html: buildTeamNotificationHtml({
            name,
            email,
            subject,
            message,
            country: body.country?.trim().slice(0, 100) || undefined,
            city_region: body.city_region?.trim().slice(0, 100) || undefined,
          }),
        });
        if (teamError) console.error("Resend team notification error:", teamError);
      } catch (err) {
        console.error("Failed to send team notification:", err);
      }

      // Auto-reply to the visitor
      try {
        const { error: autoReplyError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: "We Received Your Message — In Him Daily",
          html: buildAutoReplyHtml(name),
        });
        if (autoReplyError) console.error("Resend auto-reply error:", autoReplyError);
      } catch (err) {
        console.error("Failed to send auto-reply:", err);
      }
    } else {
      console.error("RESEND_API_KEY is not configured — contact message saved, emails skipped");
    }

    return new Response(
      JSON.stringify({ success: true, message: "Your message has been received." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
