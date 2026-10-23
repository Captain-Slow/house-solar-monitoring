import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { Kind, parse, validate, buildSchema } from 'graphql';
import { Prisma } from '../generated/prisma/client.js';
import { depthLimitEight } from './depth-rule.js';
import { DecimalScalar } from './scalars/decimal.scalar.js';

const scalar = new DecimalScalar();

describe('Decimal scalar', () => {
  it('serializes fixed-point decimal objects and accepts only constrained strings', () => {
    expect(scalar.serialize(new Decimal('12.345'))).toBe('12.345');
    expect(scalar.serialize(new Prisma.Decimal('0.500'))).toBe('0.5');
    expect(scalar.parseValue('-123456789012.123456')).toBe(
      '-123456789012.123456',
    );
    expect(scalar.parseLiteral({ kind: Kind.STRING, value: '0.000001' })).toBe(
      '0.000001',
    );
    for (const value of ['1e3', '.5', '1234567890123', '1.1234567', '+1', ''])
      expect(() => scalar.parseValue(value)).toThrow();
    expect(() => scalar.parseValue(2)).toThrow();
    expect(() => scalar.parseLiteral({ kind: Kind.INT, value: '2' })).toThrow();
  });
});

describe('GraphQL depth rule', () => {
  const schema = buildSchema(
    'type Query { a: Node! } type Node { a: Node! value: Int! }',
  );
  it('accepts depth 8 and rejects depth 9', () => {
    const query = (depth: number) =>
      parse(`{ ${'a { '.repeat(depth - 1)}value ${'} '.repeat(depth - 1)} }`);
    expect(validate(schema, query(8), [depthLimitEight])).toHaveLength(0);
    expect(validate(schema, query(9), [depthLimitEight])[0]?.message).toMatch(
      /depth/i,
    );
    expect(
      validate(
        schema,
        parse(
          'query { ...A } fragment A on Query { a { ...B } } fragment B on Node { a { a { a { a { a { a { a { value } } } } } } } }',
        ),
        [depthLimitEight],
      )[0]?.message,
    ).toMatch(/depth/i);
  });

  it('memoizes duplicated fragment expansions rather than traversing 2^30 paths', () => {
    const fragments = Array.from(
      { length: 30 },
      (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`,
    );
    const document = parse(
      `query { ...F0 } ${fragments.join(' ')} fragment F30 on Query { __typename }`,
    );
    const start = performance.now();
    expect(validate(schema, document, [depthLimitEight])).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('bounds physical field and alias counts in addition to depth', () => {
    const fields = parse(`{ ${'__typename '.repeat(1001)} }`);
    expect(
      validate(schema, fields, [depthLimitEight])[0]?.extensions?.code,
    ).toBe('BAD_USER_INPUT');
    const aliases = parse(
      `{ ${Array.from({ length: 201 }, (_, i) => `x${i}:__typename`).join(' ')} }`,
    );
    expect(
      validate(schema, aliases, [depthLimitEight])[0]?.extensions?.code,
    ).toBe('BAD_USER_INPUT');
    expect(
      validate(schema, parse('{ a { value } }'), [depthLimitEight]),
    ).toHaveLength(0);
  });
});
