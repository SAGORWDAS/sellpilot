import { ImapFlow } from 'imapflow';
import type { Mailbox } from '@/db/schema';
import { decryptSecret } from '@/lib/crypto';

export function imapClient(mailbox: Mailbox): ImapFlow {
  return new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecure,
    auth: {
      user: mailbox.imapUser,
      pass: decryptSecret(mailbox.imapSecretEnc),
    },
    logger: false,
    socketTimeout: 30_000,
  });
}

export async function verifyImap(mailbox: Mailbox): Promise<void> {
  const client = imapClient(mailbox);
  await client.connect();
  try {
    await client.logout();
  } catch {
    client.close();
  }
}