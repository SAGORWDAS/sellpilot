import nodemailer from 'nodemailer';
import type { Mailbox } from '@/db/schema';
import { decryptSecret } from '@/lib/crypto';

export type OutboundEmail = {
  to: string;
  subject: string;
  body: string;
  messageId: string;
  inReplyTo?: string | null;
  replyToken: string;
};

export function buildFooter(senderName: string, senderAddress: string | null): string {
  const identity = senderAddress ? `${senderName} · ${senderAddress}` : senderName;
  return `\n\n—\n${identity}\nNot interested? Reply "unsubscribe" and I won't email you again.`;
}

export function newMessageId(mailboxEmail: string): string {
  const domain = mailboxEmail.split('@')[1] ?? 'sellpilot.local';
  return `<${crypto.randomUUID()}@${domain}>`;
}

function transportFor(mailbox: Mailbox) {
  return nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpSecure,
    auth: {
      user: mailbox.smtpUser,
      pass: decryptSecret(mailbox.smtpSecretEnc),
    },
    connectionTimeout: 20_000,
    socketTimeout: 30_000,
  });
}

export async function sendEmail(mailbox: Mailbox, email: OutboundEmail): Promise<void> {
  if (process.env.EMAIL_DRY_RUN === '1') {
    console.log(`[dry-run] → ${email.to} | ${email.subject}\n${email.body}`);
    return;
  }
  const transport = transportFor(mailbox);
  try {
    await transport.sendMail({
      from: { name: mailbox.fromName, address: mailbox.email },
      to: email.to,
      subject: email.subject,
      text: email.body,
      messageId: email.messageId,
      ...(email.inReplyTo ? { inReplyTo: email.inReplyTo, references: email.inReplyTo } : {}),
      headers: {
        'List-Unsubscribe': `<mailto:${mailbox.email}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-SellPilot-Ref': email.replyToken,
      },
    });
  } finally {
    transport.close();
  }
}

export async function verifySmtp(mailbox: Mailbox): Promise<void> {
  const transport = transportFor(mailbox);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}