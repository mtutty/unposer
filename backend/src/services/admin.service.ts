import { db } from '../db/connection';
import { AppError, User, UserRole, UserStatus } from '../types';

// Admin/user-management foundation (see the migration's header comment for why this exists as
// part of Iteration 4 — prerequisite infrastructure for the personality engine's calibration
// console, whose own build is deferred to docs/calibration-console-spec.md).

export interface UserListFilters {
  /** Case-insensitive substring match against email or name. */
  q?: string;
  role?: UserRole;
  status?: UserStatus;
  limit?: number;
  offset?: number;
}

export interface UserListResult {
  users: User[];
  total: number;
}

const DEFAULT_LIMIT = 50;

export class AdminService {
  async listUsers(filters: UserListFilters = {}): Promise<UserListResult> {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = filters.offset ?? 0;

    const scoped = () => {
      let query = db('users');
      if (filters.q) {
        const term = `%${filters.q}%`;
        query = query.where((qb) => qb.whereILike('email', term).orWhereILike('name', term));
      }
      if (filters.role) query = query.andWhere({ role: filters.role });
      if (filters.status) query = query.andWhere({ status: filters.status });
      return query;
    };

    const [users, countRow] = await Promise.all([
      scoped().orderBy('created_at', 'desc').limit(limit).offset(offset),
      scoped().count('* as n').first()
    ]);

    return { users, total: Number(countRow?.n ?? 0) };
  }

  async getUser(id: string): Promise<User | undefined> {
    return db('users').where({ id }).first();
  }

  async updateUser(id: string, changes: { role?: UserRole; status?: UserStatus }): Promise<User> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (changes.role !== undefined) updates.role = changes.role;
    if (changes.status !== undefined) updates.status = changes.status;

    const [user] = await db('users').where({ id }).update(updates).returning('*');
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found', 404);
    }
    return user;
  }
}
