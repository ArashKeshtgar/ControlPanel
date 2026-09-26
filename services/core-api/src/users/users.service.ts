import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { User } from './user.model';

const USER_COLUMNS = 'Id, Username, PasswordHash, Role, TokenVersion';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) {}

  async findByUsername(username: string): Promise<User | null> {
    const result = await this.db
      .request()
      .input('username', username)
      .query(`SELECT ${USER_COLUMNS} FROM dbo.Users WHERE Username = @username`);

    return this.toUser(result.recordset[0]);
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.db
      .request()
      .input('id', id)
      .query(`SELECT ${USER_COLUMNS} FROM dbo.Users WHERE Id = @id`);

    return this.toUser(result.recordset[0]);
  }

  async incrementTokenVersion(id: number): Promise<void> {
    await this.db
      .request()
      .input('id', id)
      .query('UPDATE dbo.Users SET TokenVersion = TokenVersion + 1 WHERE Id = @id');
  }

  private toUser(row: any): User | null {
    if (!row) return null;
    return {
      id: row.Id,
      username: row.Username,
      passwordHash: row.PasswordHash,
      role: row.Role,
      tokenVersion: row.TokenVersion,
    };
  }
}
