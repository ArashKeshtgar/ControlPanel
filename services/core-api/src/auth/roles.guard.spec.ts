import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user?: { role: string }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows the request when the route declares no @Roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ role: 'Viewer' }))).toBe(true);
  });

  it('allows an Admin through a route that requires Admin', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);
    expect(guard.canActivate(makeContext({ role: 'Admin' }))).toBe(true);
  });

  it('blocks a Viewer from a route that requires Admin', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);
    expect(guard.canActivate(makeContext({ role: 'Viewer' }))).toBe(false);
  });

  it('blocks an unauthenticated request from a role-restricted route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });
});
