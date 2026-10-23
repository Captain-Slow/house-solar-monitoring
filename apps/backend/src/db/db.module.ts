import { Global, Module, type DynamicModule } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import type { Env } from '../config/env.js';

@Global()
@Module({})
export class DbModule {
  static forRoot(env: Env, prisma?: PrismaService): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: PrismaService,
          useFactory: () =>
            prisma ??
            new PrismaService({
              DATABASE_URL: env.DATABASE_URL,
              DATABASE_PASSWORD_FILE: env.DATABASE_PASSWORD_FILE,
            }),
        },
      ],
      exports: [PrismaService],
    };
  }
}
