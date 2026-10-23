import {
  Controller,
  Get,
  HttpException,
  Injectable,
  Module,
  type DynamicModule,
} from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../db/prisma.service.js';

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly migrationsDir = join(
      process.cwd(),
      'prisma',
      'migrations',
    ),
  ) {}

  async check(): Promise<boolean> {
    let latest: string;
    try {
      const dirs = (await readdir(this.migrationsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      latest = dirs.at(-1) ?? '';
    } catch {
      return false;
    }
    if (!latest) return false;
    let timer: NodeJS.Timeout;
    try {
      return await Promise.race([
        (async () => {
          await this.prisma.pool.query('SELECT 1');
          const result = await this.prisma.pool.query<{ applied: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied`,
            [latest],
          );
          return result.rows[0]?.applied === true;
        })(),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 2000);
        }),
      ]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer!);
    }
  }
}

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}
  @Get('healthz') health() {
    return { status: 'ok' };
  }
  @Get('readyz') async ready() {
    if (!(await this.readiness.check()))
      throw new HttpException({ status: 'unavailable' }, 503);
    return { status: 'ok' };
  }
}

@Module({})
export class HealthModule {
  static forRoot(migrationsDir?: string): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        {
          provide: ReadinessService,
          useFactory: (prisma: PrismaService) =>
            new ReadinessService(prisma, migrationsDir),
          inject: [PrismaService],
        },
      ],
    };
  }
}
