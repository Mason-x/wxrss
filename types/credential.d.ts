export interface ProfileCredential {
  uin: string;
  key: string;
  pass_ticket: string;
  timestamp?: number;
}

export interface ParsedCredential extends ProfileCredential {
  nickname?: string;
  avatar?: string;
  biz: string;
  wap_sid2: string;
  appmsg_token: string;
  cookie: string;
  exportkey?: string;
  user_agent?: string;
  referer?: string;
  acct_mode?: string;
  timestamp: number;
  time?: string;
  valid: boolean;
  added?: boolean;
}
