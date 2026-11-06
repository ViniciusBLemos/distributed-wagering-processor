
export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private static readonly MAX_CENTS = 10n ** 20n - 1n;

  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (
      !props ||
      typeof props.amount !== 'string' ||
      typeof props.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(props.currency) ||
      !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(props.amount)
    ) {
      throw new Error('Invalid money');
    }

    const [integer, fraction = ''] = props.amount.split('.');

    const cents =
      BigInt(integer) * 100n +
      BigInt(fraction.padEnd(2, '0') || '0');

    if (cents > Money.MAX_CENTS) {
      throw new Error('Money amount exceeds maximum');
    }

    return new Money(cents, props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.cents - other.cents, this.currency);
  }

  negate(): Money {
    return new Money(-this.cents, this.currency);
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  isPositive(): boolean {
    return this.cents > 0n;
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.cents === other.cents;
  }

  toJSON(): MoneyProps {
    const sign = this.cents < 0n ? '-' : '';
    const absolute = this.cents < 0n ? -this.cents : this.cents;

    const integer = absolute / 100n;
    const fraction = (absolute % 100n).toString().padStart(2, '0');

    return {
      amount: `${sign}${integer}.${fraction}`,
      currency: this.currency,
    };
  }

  toString(): string {
    return this.toJSON().amount;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('Currency mismatch');
    }
  }
}
