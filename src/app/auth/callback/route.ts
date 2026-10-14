import { finishSignIn } from "@/lib/oauth/chatgpt";

// ChatGPT redirects here on http://127.0.0.1:<port>/auth/callback (the exact path is part of the registration).
export async function GET(request: Request) {
  try {
    return Response.redirect(await finishSignIn(new URL(request.url)), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="font-family:system-ui;padding:40px;background:#f4f4f4"><h1 style="letter-spacing:-.03em">Sign-in failed</h1><p>${message.replace(/[<>&]/g, "")}</p><p><a href="/login">Back to sign in</a></p>`, {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
