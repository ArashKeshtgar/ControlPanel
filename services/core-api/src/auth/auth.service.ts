import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new UnauthorizedException('Invalid username or password.');

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException('Invalid username or password.');

    const payload = { sub: user.id, username: user.username, role: user.role };
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '15m' }),
      refreshToken: this.jwt.sign(payload, { expiresIn: '7d' }),
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken);
      const { sub, username, role } = payload;
      return {
        accessToken: this.jwt.sign({ sub, username, role }, { expiresIn: '15m' }),
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
  }
}
