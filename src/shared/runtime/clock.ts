export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const createFixedClock = (instant: Date | string): Clock => {
  const value = instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);

  if (!Number.isFinite(value.getTime())) {
    throw new RangeError("Fixed clock instant must be a valid date");
  }

  const timestamp = value.getTime();
  return {
    now: () => new Date(timestamp),
  };
};
