import { Resend } from "resend";

/** The one thing we need from an email provider. Tests pass a fake; production wraps Resend. */
export interface EmailSender {
  send(msg: { from: string; to: string; subject: string; html: string; text: string }): Promise<void>;
}

/** A Resend-backed sender, or null when RESEND_API_KEY isn't set (the demo default). */
export function resendSenderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  const client = new Resend(key);
  return {
    async send(msg) {
      // The SDK returns { error } instead of throwing, so surface it ourselves.
      const { error } = await client.emails.send(msg);
      if (error) throw new Error(error.message);
    },
  };
}
