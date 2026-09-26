import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { User } from './user.model';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) {}

  async findByUsername(username: string): Promise<User | null> {
    const result = await this.db
      .request()
      .input('username', username)
      .query('SELECT Id, Username, PasswordHash, Role FROM dbo.Users WHERE Username = @username');

    const row = result.recordset[0];
    if (!row) return null;

    return { id: row.Id, username: row.Username, passwordHash: row.PasswordHash, role: row.Role };
  }
}
