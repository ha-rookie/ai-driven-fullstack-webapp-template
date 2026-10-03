import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStringFieldPolicies,
  maskEmail,
  maskPhone,
  presentSensitiveString,
  type SensitiveStringFieldPolicy,
  type SensitiveStringFieldRule,
} from "../src/shared/data-masking";

interface ExampleContext {
  readonly canReveal: boolean;
  readonly canSeeMasked: boolean;
}

const policy: SensitiveStringFieldPolicy<ExampleContext> = {
  decide: (context) => {
    if (context.canReveal) return "reveal";
    if (context.canSeeMasked) return "mask";
    return "omit";
  },
};

const emailRule: SensitiveStringFieldRule<ExampleContext> = {
  policy,
  mask: maskEmail,
};

const phoneRule: SensitiveStringFieldRule<ExampleContext> = {
  policy,
  mask: maskPhone,
};

test("maskEmail reveals only a small local prefix and keeps the domain", () => {
  assert.equal(maskEmail("alice@example.com"), "a***@example.com");
  assert.equal(maskEmail("a@example.com"), "***@example.com");
});

test("maskEmail never returns invalid input unchanged", () => {
  assert.equal(maskEmail("not-an-email"), "***");
  assert.equal(maskEmail("@example.com"), "***");
  assert.equal(maskEmail("alice@"), "***");
});

test("maskPhone keeps only the final four digits for normal numbers", () => {
  assert.equal(maskPhone("090-1234-5678"), "***-****-5678");
  assert.equal(maskPhone("+81 90 1234 5678"), "+** ** **** 5678");
});

test("maskPhone fully masks short numbers and does not echo digit-free input", () => {
  assert.equal(maskPhone("1234"), "****");
  assert.equal(maskPhone("abc"), "***");
});

test("only an explicit reveal decision returns the original value", () => {
  assert.deepEqual(
    presentSensitiveString("alice@example.com", { canReveal: true, canSeeMasked: true }, emailRule),
    { decision: "reveal", value: "alice@example.com" },
  );
});

test("mask and omit decisions do not return the original value", () => {
  assert.deepEqual(
    presentSensitiveString("alice@example.com", { canReveal: false, canSeeMasked: true }, emailRule),
    { decision: "mask", value: "a***@example.com" },
  );
  assert.deepEqual(
    presentSensitiveString("alice@example.com", { canReveal: false, canSeeMasked: false }, emailRule),
    { decision: "omit" },
  );
});

test("policy failures and invalid runtime decisions fail closed to omit", () => {
  const throwingRule: SensitiveStringFieldRule<ExampleContext> = {
    policy: {
      decide: () => {
        throw new Error("policy unavailable");
      },
    },
    mask: maskEmail,
  };
  const invalidRule: SensitiveStringFieldRule<ExampleContext> = {
    policy: {
      decide: () => "unexpected" as never,
    },
    mask: maskEmail,
  };

  assert.deepEqual(
    presentSensitiveString("alice@example.com", { canReveal: false, canSeeMasked: false }, throwingRule),
    { decision: "omit" },
  );
  assert.deepEqual(
    presentSensitiveString("alice@example.com", { canReveal: false, canSeeMasked: false }, invalidRule),
    { decision: "omit" },
  );
});

test("a broken masker cannot accidentally return the original sensitive value", () => {
  const passthroughRule: SensitiveStringFieldRule<ExampleContext> = {
    policy: { decide: () => "mask" },
    mask: (value) => value,
  };
  const throwingMaskerRule: SensitiveStringFieldRule<ExampleContext> = {
    policy: { decide: () => "mask" },
    mask: () => {
      throw new Error("mask unavailable");
    },
  };

  assert.deepEqual(
    presentSensitiveString("secret", { canReveal: false, canSeeMasked: true }, passthroughRule),
    { decision: "omit" },
  );
  assert.deepEqual(
    presentSensitiveString("secret", { canReveal: false, canSeeMasked: true }, throwingMaskerRule),
    { decision: "omit" },
  );
});

test("applyStringFieldPolicies creates a response-safe DTO without mutating the source", () => {
  const source = {
    id: "user-1",
    displayName: "Alice",
    email: "alice@example.com",
    phone: "090-1234-5678",
  };

  const result = applyStringFieldPolicies(
    source,
    { canReveal: false, canSeeMasked: true },
    {
      email: emailRule,
      phone: phoneRule,
    },
  );

  assert.deepEqual(result, {
    id: "user-1",
    displayName: "Alice",
    email: "a***@example.com",
    phone: "***-****-5678",
  });
  assert.deepEqual(source, {
    id: "user-1",
    displayName: "Alice",
    email: "alice@example.com",
    phone: "090-1234-5678",
  });
});

test("applyStringFieldPolicies omits protected fields when policy denies or runtime shape is unsafe", () => {
  const denied = applyStringFieldPolicies(
    {
      id: "user-1",
      email: "alice@example.com",
      phone: "090-1234-5678",
    },
    { canReveal: false, canSeeMasked: false },
    { email: emailRule, phone: phoneRule },
  );

  assert.deepEqual(denied, { id: "user-1" });

  const invalidShape = applyStringFieldPolicies(
    {
      id: "user-1",
      email: 12345,
    },
    { canReveal: false, canSeeMasked: true },
    { email: emailRule },
  );

  assert.deepEqual(invalidShape, { id: "user-1" });
});
