// Optional transactional email via AWS SES (us-east-2).
//
// Every send is best-effort: if SES_FROM is unset the calls no-op, and any SDK/network
// failure is caught and logged. Email MUST NEVER fail the request it is attached to —
// a signup or an approval succeeds whether or not the notification goes out.
import { getConfig } from '../config.js';

interface SendArgs {
  to: string;
  subject: string;
  body: string;
}

async function send({ to, subject, body }: SendArgs): Promise<void> {
  const from = getConfig().sesFrom;
  if (!from) return; // email disabled — silently skip

  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    const client = new SESClient({ region: 'us-east-2' });
    await client.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Text: { Data: body, Charset: 'UTF-8' } },
        },
      }),
    );
  } catch (err) {
    console.warn(`[email] failed to send "${subject}" to ${to}`, err);
  }
}

/** Acknowledge a new applicant that their account is awaiting review. */
export async function sendSignupReceived(to: string, fullName: string): Promise<void> {
  await send({
    to,
    subject: 'Your Kyron Scribe application was received',
    body:
      `Hi ${fullName},\n\n` +
      'Thanks for applying to Kyron Scribe. Your account is awaiting administrator ' +
      'review — we will email you again as soon as it is approved.\n\n' +
      '— The Kyron Scribe team',
  });
}

/** Notify an applicant that an admin approved their account. */
export async function sendApproved(to: string, fullName: string): Promise<void> {
  await send({
    to,
    subject: 'Your Kyron Scribe account is approved',
    body:
      `Hi ${fullName},\n\n` +
      'Good news — your Kyron Scribe account has been approved. You can now sign in ' +
      'and start documenting encounters.\n\n' +
      '— The Kyron Scribe team',
  });
}
