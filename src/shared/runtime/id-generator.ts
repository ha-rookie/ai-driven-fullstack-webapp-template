export interface IdGenerator {
  generate(): string;
}

export const cryptoIdGenerator: IdGenerator = {
  generate: () => crypto.randomUUID(),
};
