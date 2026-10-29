
export {};

declare global {
  interface Window {
    __firebase_config?: string | {
      apiKey: string;
      authDomain?: string;
      projectId: string;
      storageBucket?: string;
      messagingSenderId?: string;
      appId: string;
    };
    __app_id?: string;
    __initial_auth_token?: string;
  }
}
