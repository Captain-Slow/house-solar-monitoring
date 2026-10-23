import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import type { GraphQLResolveInfo } from 'graphql';
import type { AuthRequest } from './token.middleware.js';
import type { TokenRole } from '../generated/prisma/client.js';

export const ROLES = 'roles';
export const Roles = (...roles: TokenRole[]) => SetMetadata(ROLES, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<string>() !== 'graphql') return true;
    const gql = GqlExecutionContext.create(context);
    const info = gql.getInfo<GraphQLResolveInfo>();
    const roles = this.reflector.getAllAndOverride<TokenRole[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required =
      info.parentType.name === 'Mutation' ? ['ADMIN'] : (roles ?? []);
    if (required.length === 0) return true;
    const request = gql.getContext<{ req: AuthRequest }>().req;
    if (request.principal && required.includes(request.principal.role))
      return true;
    throw new ForbiddenException('Forbidden');
  }
}
