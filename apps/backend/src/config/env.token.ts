import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Env } from './env.js';

export const APP_ENV = Symbol('APP_ENV');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_ENV, useValue: env }],
      exports: [APP_ENV],
    };
  }
}
