
import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('soma valores sem erros de precisão', () => {
    const a = Money.from({ amount: '0.10', currency: 'BRL' });
    const b = Money.from({ amount: '0.20', currency: 'BRL' });

    expect(a.add(b).toJSON().amount).toBe('0.30');
  });

  it('subtrai valores corretamente', () => {
    const a = Money.from({ amount: '100.00', currency: 'BRL' });
    const b = Money.from({ amount: '80.00', currency: 'BRL' });

    expect(a.subtract(b).toString()).toBe('20.00');
  });

  it('rejeita valores negativos na entrada', () => {
    expect(() =>
      Money.from({ amount: '-10.00', currency: 'BRL' }),
    ).toThrow();
  });

  it('rejeita valores com mais de duas casas decimais', () => {
    expect(() =>
      Money.from({ amount: '10.999', currency: 'BRL' }),
    ).toThrow();
  });

  it('impede operações entre moedas diferentes', () => {
    const brl = Money.from({ amount: '10.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow('Currency mismatch');
  });

  it('não altera os objetos originais', () => {
    const original = Money.from({
      amount: '10.00',
      currency: 'BRL',
    });

    original.add(Money.from({
      amount: '5.00',
      currency: 'BRL',
    }));

    expect(original.toString()).toBe('10.00');
  });
});
