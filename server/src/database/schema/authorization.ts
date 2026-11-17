import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  foreignKey,
  index,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './auth.js';

/**
 * Authorization tables — DATABASE_DESIGN.md §5.1 (`roles`), §5.2 (`permissions`),
 * §5.3 (`role_permissions`), §5.4 (`user_roles`).
 *
 * The permission catalogue is code-defined (in `shared/`) and seeded in Phase 2;
 * these tables are the runtime source the authorization middleware checks.
 */

export const roles = mysqlTable(
  'roles',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // SUPER_ADMIN | ADMIN | STORE_ADMIN | CUSTOMER
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 255 }),
    // System roles cannot be deleted or renamed.
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('uq_roles_code').on(table.code)],
);

export const permissions = mysqlTable(
  'permissions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    // e.g. 'cms.pages.publish', 'store.orders.approve' (PERMISSIONS.md catalogue)
    code: varchar('code', { length: 80 }).notNull(),
    // cms | museum | news | foundation | store | users | audit | settings
    module: varchar('module', { length: 40 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    uniqueIndex('uq_permissions_code').on(table.code),
    index('idx_permissions_module').on(table.module),
  ],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
    permissionId: bigint('permission_id', { mode: 'number', unsigned: true }).notNull(),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('idx_rp_permission').on(table.permissionId),
    // Pure join table: the child is meaningless alone, so CASCADE (§2.8, §5.3).
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'fk_rp_role',
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.permissionId],
      foreignColumns: [permissions.id],
      name: 'fk_rp_permission',
    })
      .onDelete('cascade')
      .onUpdate('restrict'),
  ],
);

export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: bigint('user_id', { mode: 'number', unsigned: true }).notNull(),
    roleId: bigint('role_id', { mode: 'number', unsigned: true }).notNull(),
    // Admin who granted the role; NULL for self-registered CUSTOMER / bootstrap.
    grantedBy: bigint('granted_by', { mode: 'number', unsigned: true }),
    createdAt: datetime('created_at', { fsp: 3, mode: 'date' })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('idx_ur_role').on(table.roleId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_ur_user',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: 'fk_ur_role',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      columns: [table.grantedBy],
      foreignColumns: [users.id],
      name: 'fk_ur_grantor',
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
  ],
);
