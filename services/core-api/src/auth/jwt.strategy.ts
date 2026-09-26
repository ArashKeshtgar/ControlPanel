import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { requireSecret } from './jwt-config';

export interface JwtPayload {
  sub: number;
  username: string;
  role: 'Admin' | 'Viewer';
  typ: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireSecret(config, 'JWT_SECRET'),
    });
  }

  // Defense in depth: refresh tokens are already signed with a different
  // secret, but an explicit type check means a token minted for any other
  // purpose is rejected here even if the secrets were ever misconfigured.
  validate(payload: JwtPayload): JwtPayload {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Only access tokens are accepted here.');
    }
    return payload;
  }
}
