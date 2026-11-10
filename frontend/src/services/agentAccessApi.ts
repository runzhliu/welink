import axios from 'axios';
import { getServerURL } from '../runtimeConfig';
import { sensitiveSessionHeaders } from './sftApi';

export interface AgentAccessStatus {
  state: 'none' | 'active' | 'expired' | 'legacy' | 'invalid' | 'other_account';
  conversations?: string[];
  actions?: string[];
  expires_at?: string;
}

const url = () => `${getServerURL().replace(/\/+$/, '')}/api/agent/access`;
export const agentAccessApi = {
  status: () => axios.get<AgentAccessStatus>(url(), { headers: sensitiveSessionHeaders() }).then(r => r.data),
  create: (conversations: string[], actions: string[], hours: number) =>
    axios.post<{ token: string; expires_at: string }>(url(), { conversations, actions, hours }, { headers: sensitiveSessionHeaders() }).then(r => r.data),
  revoke: () => axios.delete<{ state: 'none' }>(url(), { headers: sensitiveSessionHeaders() }).then(r => r.data),
};
