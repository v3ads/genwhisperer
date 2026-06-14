import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      window.location.href = "/auth/signin";
    }
    return Promise.reject(err);
  }
);

export interface User {
  id: number;
  email: string;
  role: "user" | "admin";
  suspended: boolean;
}

export interface ChatStatus {
  trialMessagesUsed: number;
  trialMessageCap: number;
  trialExhausted: boolean;
  hasOwnKey: boolean;
  maskedKey: string | null;
  preferredModel: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}
