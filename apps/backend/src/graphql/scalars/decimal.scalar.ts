import { Scalar, type CustomScalar } from '@nestjs/graphql';
import { Kind, type ValueNode } from 'graphql';
import { Decimal } from 'decimal.js';
import { Prisma } from '../../generated/prisma/client.js';

const DECIMAL_FORMAT = /^-?\d{1,12}(\.\d{1,6})?$/;

@Scalar('Decimal')
export class DecimalScalar implements CustomScalar<string, string> {
  description =
    'Decimal encoded as a fixed-point string (up to 12 integer and 6 fractional digits).';

  parseValue(value: unknown): string {
    if (typeof value !== 'string' || !DECIMAL_FORMAT.test(value))
      throw new TypeError('Decimal must be a fixed-point string');
    return value;
  }

  parseLiteral(ast: ValueNode): string {
    if (ast.kind !== Kind.STRING)
      throw new TypeError('Decimal must be a string');
    return this.parseValue(ast.value);
  }

  serialize(value: unknown): string {
    if (typeof value === 'string' && DECIMAL_FORMAT.test(value)) return value;
    if (!Decimal.isDecimal(value) && !Prisma.Decimal.isDecimal(value))
      throw new TypeError('Decimal value must be a Decimal instance');
    return value.toFixed();
  }
}
