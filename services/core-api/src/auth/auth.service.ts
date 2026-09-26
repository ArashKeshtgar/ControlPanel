import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.model';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, requireSecret } from './jwt-config';

interface RefreshPayload {
  sub: number;
  typ: 'refresh';
  tv: number;
}

@Injectable()
export class AuthService {
  private readonly refreshSecret: string;

  constructor(
    private users: UsersService,
    private jwt: JwtService,
    config: ConfigService,
  ) {
    this.refreshSecret = requireSecret(config, 'JWT_REFRESH_SECRET');
  }

  async login(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException('Invalid username or password.');

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException('Invalid username or password.');

    return {
      ...this.issueTokens(user),
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  // Refresh tokens are single-purpose (own secret + typ claim) and carry the
  // user's current TokenVersion; each refresh returns a fresh pair. The user
  // row is re-read every time, so a deleted user, a changed role, or a
  // logout / password reset (both bump TokenVersion) takes effect on the
  // next refresh instead of living on for the token's full 7 days. Earlier
  // refresh tokens stay valid until then — there is no per-token reuse
  // detection, which would need a server-side token table.
  async refresh(refreshToken: string) {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Not a refresh token.');

    const user = await this.users.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Refresh token has been revoked.');
    }

    return this.issueTokens(user);
  }

  // Revokes every outstanding refresh token for this user. Access tokens
  // already issued stay valid until they expire (at most 15 minutes) —
  // the standard trade-off for stateless access tokens.
  async logout(userId: number): Promise<void> {
    await this.users.incrementTokenVersion(userId);
  }

  private issueTokens(user: User) {
    return {
      accessToken: this.jwt.sign(
        { sub: user.id, username: user.username, role: user.role, typ: 'access' },
        { expiresIn: ACCESS_TOKEN_TTL },
      ),
      refreshToken: this.jwt.sign(
        { sub: user.id, typ: 'refresh', tv: user.tokenVersion },
        { expiresIn: REFRESH_TOKEN_TTL, secret: this.refreshSecret },
      ),
    };
  }
}
