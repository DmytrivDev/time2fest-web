/**
 * Better Auth options that decide the DATABASE SHAPE (SPEC-10 W10, [П-4]): model names, snake_case columns, additional
 * fields and plugins. Runtime callbacks (hooks, cookies, IP headers, linking) are added later by `auth/instance.ts`;
 * they do not change the schema. The same function feeds the CLI generator (`cli.config.ts`) and the schema check
 * (`cli/authSchemaCheck.ts`), so the migration and the check can never disagree with the running instance.
 */
import { anonymous } from 'better-auth/plugins/anonymous';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

export interface AuthStaticInput {
  /** Delivers the sign-in code; the real sender is injected at runtime. */
  sendOtp: (args: { email: string; otp: string; type: string }) => Promise<void>;
  googleDiscoveryUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Runtime only (SPEC-10 W30): the guest merge; never changes the schema. */
  onLinkAccount?: NonNullable<Parameters<typeof anonymous>[0]>['onLinkAccount'];
}

/** Plain-object options (no `as const`, so Better Auth infers the plugin endpoints). */
export function authStaticOptions(input: AuthStaticInput) {
  return {
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    advanced: { database: { generateId: 'uuid' as const } },
    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        deviceId: { type: 'string' as const, required: false, input: false, fieldName: 'device_id' },
      },
    },
    session: {
      modelName: 'user_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        deviceId: { type: 'string' as const, required: false, input: false, fieldName: 'device_id' },
      },
    },
    account: {
      modelName: 'user_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [
      anonymous({
        schema: { user: { fields: { isAnonymous: 'is_anonymous' } } },
        ...(input.onLinkAccount ? { onLinkAccount: input.onLinkAccount } : {}),
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        disableSignUp: false,
        sendVerificationOTP: async ({ email, otp, type }) => input.sendOtp({ email, otp, type }),
      }),
      genericOAuth({
        config: [
          {
            providerId: 'google',
            discoveryUrl: input.googleDiscoveryUrl,
            clientId: input.googleClientId,
            clientSecret: input.googleClientSecret,
            scopes: ['openid', 'email', 'profile'],
            pkce: true,
          },
        ],
      }),
    ],
  };
}
