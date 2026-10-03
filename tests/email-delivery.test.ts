import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareEmailProvider,
  EmailDeliveryError,
  InMemoryEmailProvider,
  TransactionalEmailService,
  createEmailDeliveryConfig,
  resolveTransactionalEmail,
  toSafeEmailDeliveryFields,
  type CloudflareEmailBinding,
} from "../src/shared/email";

const config = createEmailDeliveryConfig({
  fromAddress: "noreply@example.com",
  fromName: "Example App",
  replyToAddress: "support@example.com",
});

test("transactional email service injects sender config and supports text/html", async () => {
  const provider = new InMemoryEmailProvider();
  const service = new TransactionalEmailService(provider, config);

  const result = await service.send({
    to: { email: "user@example.com", name: "Example User" },
    subject: "Welcome",
    text: "Welcome to the service",
    html: "<p>Welcome to the service</p>",
  });

  assert.equal(result.messageId, "in-memory-1");
  assert.equal(provider.sent.length, 1);
  assert.deepEqual(provider.sent[0]?.from, {
    email: "noreply@example.com",
    name: "Example App",
  });
  assert.deepEqual(provider.sent[0]?.replyTo, { email: "support@example.com" });
  assert.equal(provider.sent[0]?.to[0]?.email, "user@example.com");
  assert.equal(provider.sent[0]?.text, "Welcome to the service");
  assert.equal(provider.sent[0]?.html, "<p>Welcome to the service</p>");
});

test("email validation rejects header injection and malformed addresses", () => {
  assert.throws(
    () => createEmailDeliveryConfig({
      fromAddress: "noreply@example.com\r\nBcc: attacker@example.com",
    }),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "invalid_message",
  );

  assert.throws(
    () => resolveTransactionalEmail(config, {
      to: "not-an-address",
      subject: "Hello",
      text: "Body",
    }),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "invalid_message",
  );

  assert.throws(
    () => resolveTransactionalEmail(config, {
      to: "user@example.com",
      subject: "Hello\nInjected: value",
      text: "Body",
    }),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "invalid_message",
  );
});

test("transactional email requires at least text or html content", () => {
  assert.throws(
    () => resolveTransactionalEmail(config, {
      to: "user@example.com",
      subject: "No body",
    }),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "invalid_message",
  );
});

test("request reply-to can override configured reply-to", () => {
  const message = resolveTransactionalEmail(config, {
    to: "user@example.com",
    subject: "Reply here",
    text: "Body",
    replyTo: { email: "team@example.com", name: "Team" },
  });

  assert.deepEqual(message.replyTo, { email: "team@example.com", name: "Team" });
});

test("safe email delivery fields never include addresses, subject, or body", () => {
  const message = resolveTransactionalEmail(config, {
    to: ["user1@example.com", "user2@example.com"],
    cc: "manager@example.com",
    subject: "Secret reset token: ABC123",
    text: "token=ABC123",
  });

  const safe = toSafeEmailDeliveryFields(message);
  assert.deepEqual(safe, {
    recipientCount: 3,
    hasText: true,
    hasHtml: false,
    hasReplyTo: true,
  });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /example\.com|ABC123|token=/u);
});

test("Cloudflare adapter maps the provider-neutral model to Workers binding", async () => {
  const received: unknown[] = [];
  const binding: CloudflareEmailBinding = {
    async send(message) {
      received.push(message);
      return { messageId: "cf-message-1" };
    },
  };
  const service = new TransactionalEmailService(
    new CloudflareEmailProvider(binding),
    config,
  );

  const result = await service.send({
    to: ["user@example.com"],
    cc: { email: "manager@example.com", name: "Manager" },
    bcc: "audit@example.com",
    subject: "Notification",
    text: "Plain text",
    html: "<p>HTML</p>",
  });

  assert.equal(result.messageId, "cf-message-1");
  assert.deepEqual(received, [{
    from: { email: "noreply@example.com", name: "Example App" },
    to: [{ email: "user@example.com" }],
    cc: [{ email: "manager@example.com", name: "Manager" }],
    bcc: [{ email: "audit@example.com" }],
    replyTo: { email: "support@example.com" },
    subject: "Notification",
    text: "Plain text",
    html: "<p>HTML</p>",
  }]);
});

test("Cloudflare adapter maps known provider errors without leaking provider message", async () => {
  const binding: CloudflareEmailBinding = {
    async send() {
      const error = new Error("raw provider details");
      Object.assign(error, { code: "E_RATE_LIMIT_EXCEEDED" });
      throw error;
    },
  };
  const service = new TransactionalEmailService(
    new CloudflareEmailProvider(binding),
    config,
  );

  await assert.rejects(
    () => service.send({
      to: "user@example.com",
      subject: "Notification",
      text: "Body",
    }),
    (error: unknown) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, "rate_limited");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /raw provider details/u);
      return true;
    },
  );
});

test("unknown Cloudflare failures are not automatically classified retryable", async () => {
  const binding: CloudflareEmailBinding = {
    async send() {
      throw new Error("ambiguous transport failure");
    },
  };
  const provider = new CloudflareEmailProvider(binding);

  await assert.rejects(
    () => provider.send(resolveTransactionalEmail(config, {
      to: "user@example.com",
      subject: "Notification",
      text: "Body",
    })),
    (error: unknown) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, "provider_error");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});

test("in-memory provider never performs external delivery", async () => {
  const provider = new InMemoryEmailProvider();
  const service = new TransactionalEmailService(provider, config);
  await service.send({
    to: "local@example.com",
    subject: "Local test",
    text: "No external send",
  });

  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0]?.to[0]?.email, "local@example.com");
});
