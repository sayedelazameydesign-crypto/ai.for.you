export interface SqlRuleFailure {
  rule: string
  detail: string
}

export function validateMigrationSql(sql: string, file?: string): SqlRuleFailure[]
