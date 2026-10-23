import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { TokenMiddleware } from './token.middleware.js';
import { TokenService } from './token.service.js';

@Module({
  providers: [
    TokenService,
    TokenMiddleware,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TokenMiddleware).forRoutes('graphql');
  }
}
