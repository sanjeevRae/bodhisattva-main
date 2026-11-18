/**
 * Mailer service (spec Part 16 transport seam for Phase 2 auth mail).
 *
 * A thin nodemailer wrapper built from AppConfig.smtp. In development the
 * SMTP settings point at a local mail catcher (localhost:1025, e.g. Mailpit);
 * no real mailbox is required for Phase 2 (DEVELOPMENT_ROADMAP.md §4
 * dependencies — the production SMTP route is Meena's later decision).
 *
 * The transport is injectable for tests: pass a nodemailer Transporter to
 * createMailer(), or replace the process-wide default via
 * setTransportForTesting().
 *
 * NEVER log message bodies, verification codes or tokens here — callers log
 * only delivery failures (recipient domain + error), never content.
 */
import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../config/env.js";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * Per-message From override (contact form, migration 0012: the
   * configured contact identity "Name <alerts@…>", which may differ
   * from the platform-wide SMTP_FROM). Absent → config.smtp.from.
   * Callers must only ever pass server-configured values here.
   */
  from?: string;
  /**
   * Per-message Reply-To (contact form: the visitor's validated email,
   * so staff can simply hit reply). Absent → no Reply-To header.
   */
  replyTo?: string;
  /** Phase 7: the invoice PDF rides the outbox invoice mail. */
  attachments?: MailAttachment[];
  /**
   * Explicit RFC 5322 Message-ID (Phase 8). The outbox sets a
   * deterministic one per row so retries of the same row carry the
   * same id (downstream dedupe) while a resend — a new row — gets a
   * new one. Absent → nodemailer generates one.
   */
  messageId?: string;
}

export interface MailSendResult {
  /** The message id assigned by the sending server, when it reports one. */
  messageId?: string;
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<MailSendResult>;
}

export function createMailer(
  config: AppConfig,
  transport?: Transporter,
): Mailer {
  const transporter =
    transport ??
    nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      // TLS semantics (verified against the nodemailer SMTP docs for the
      // contact-form spec, Phase 2.3): port 465 → implicit TLS
      // (secure=true); any other port (587 submission) → plain connect
      // upgraded via STARTTLS when the server advertises it
      // (secure=false). Certificate validation stays at nodemailer's
      // default (rejectUnauthorized is never disabled here).
      secure: config.smtp.port === 465,
      // Explicit timeouts (Phase 8, Phase 7 review disposition 2): a
      // hung connection must fail fast — far below the outbox's
      // 5-minute lease — never outlive the claim that sent it.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      ...(config.smtp.user
        ? { auth: { user: config.smtp.user, pass: config.smtp.password } }
        : {}),
    });

  return {
    async sendMail(message: MailMessage): Promise<MailSendResult> {
      const info = await transporter.sendMail({
        from: message.from ?? config.smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
        ...(message.html ? { html: message.html } : {}),
        ...(message.attachments && message.attachments.length > 0
          ? {
              attachments: message.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { contentType: a.contentType } : {}),
              })),
            }
          : {}),
      });
      return { messageId: info.messageId };
    },
  };
}

let testingTransport: Transporter | undefined;

/** Replace the transport used by getMailer() — test suites only. */
export function setTransportForTesting(transport: Transporter | undefined): void {
  testingTransport = transport;
}

const defaultMailers = new WeakMap<AppConfig, Mailer>();

/** Process-wide mailer for a config, honouring setTransportForTesting(). */
export function getMailer(config: AppConfig): Mailer {
  if (testingTransport) return createMailer(config, testingTransport);
  let mailer = defaultMailers.get(config);
  if (!mailer) {
    mailer = createMailer(config);
    defaultMailers.set(config, mailer);
  }
  return mailer;
}
