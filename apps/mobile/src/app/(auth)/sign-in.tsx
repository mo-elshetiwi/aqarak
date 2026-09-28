import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type Text as NativeText,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/ui/tag";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { useSession } from "@/features/auth/session-provider";
import { authError } from "@/features/auth/auth-client";
import { demoUsernames } from "@/features/auth/fixture-auth-client";
import { config } from "@/config";
type ErrorKey =
  | "requiredUsername"
  | "requiredPassword"
  | `errors.${ReturnType<typeof authError>["code"]}`;
/** A custom bilingual form keeps credentials in component memory only. */
export default function SignInScreen(): ReactNode {
  const t = useTranslations("Mobile");
  const { state, signIn, retryRestore, signOut } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [usernameError, setUsernameError] = useState<ErrorKey | null>(null);
  const [passwordError, setPasswordError] = useState<ErrorKey | null>(null);
  const summary = useRef<NativeText>(null);
  const errors = [usernameError, passwordError].filter(
    (key): key is ErrorKey => key !== null,
  );
  useEffect(() => {
    if (!usernameError && !passwordError) return;
    const handle = findNodeHandle(summary.current);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [usernameError, passwordError]);
  async function submit(): Promise<void> {
    if (pendingRef.current) return;
    setUsernameError(username.length ? null : "requiredUsername");
    setPasswordError(password.length ? null : "requiredPassword");
    if (!username.length || !password.length) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await signIn({ username, password });
      setPassword("");
    } catch (error) {
      const failure = authError(error);
      setPasswordError(`errors.${failure.code}`);
      if (failure.code === "invalid_credentials") setPassword("");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  if (state.status === "restore_failed") {
    return (
      <SafeAreaView
        className="flex-1 gap-6 bg-background p-4"
        testID="restore-failed"
      >
        <LocaleSwitch />
        <Text variant="h1">{t("productName")}</Text>
        <Text accessibilityLiveRegion="polite">{t("restoreFailed")}</Text>
        <Button
          testID="restore-retry"
          label={t("retry")}
          onPress={() => {
            void retryRestore();
          }}
        />
        <Button
          testID="sign-out"
          variant="outline"
          label={t("signOut")}
          onPress={() => {
            void signOut();
          }}
        />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView className="flex-1 bg-background" testID="sign-in-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 24 }}
        >
          <View className="self-end">
            <LocaleSwitch />
          </View>
          <Text variant="display">{t("productName")}</Text>
          <View className="gap-6 rounded-lg border border-border bg-card p-4">
            <View className="gap-2">
              <Text variant="h1">{t("signIn")}</Text>
              <Text>{t("credentialsHint")}</Text>
            </View>
            {state.status === "signed_out" &&
              state.reason === "session_ended" && (
                <Text accessibilityLiveRegion="polite">
                  {t("sessionEnded")}
                </Text>
              )}
            {errors.length > 0 && (
              <Text
                ref={summary}
                testID="sign-in-error-summary"
                accessible
                accessibilityLiveRegion="polite"
                className="text-destructive"
              >
                {errors.map((key) => t(key)).join("\n")}
              </Text>
            )}
            <View className="gap-2">
              <Label>{t("username")}</Label>
              <Input
                testID="sign-in-username"
                accessibilityLabel={t("username")}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                maxLength={128}
                editable={!pending}
              />
              {usernameError && (
                <Text variant="caption" className="text-destructive">
                  {t(usernameError)}
                </Text>
              )}
            </View>
            <View className="gap-2">
              <Label>{t("password")}</Label>
              <Input
                testID="sign-in-password"
                accessibilityLabel={t("password")}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!visible}
                textContentType="password"
                autoComplete="password"
                maxLength={256}
                editable={!pending}
              />
              <Button
                variant="ghost"
                testID="sign-in-password-toggle"
                label={t(visible ? "hidePassword" : "showPassword")}
                onPress={() => {
                  setVisible(!visible);
                }}
              />
              {passwordError && (
                <Text variant="caption" className="text-destructive">
                  {t(passwordError)}
                </Text>
              )}
            </View>
            <Button
              testID="sign-in-submit"
              label={t(pending ? "signingIn" : "signIn")}
              loading={pending}
              onPress={() => {
                void submit();
              }}
            />
            <Text variant="caption" className="text-muted-foreground">
              {t("passwordHint")}
            </Text>
          </View>
          {config.adapter === "fixture" && (
            <View className="gap-2">
              <Tag>{t("demo")}</Tag>
              <Text testID="demo-accounts" variant="caption">
                {t("demoAccounts", { usernames: demoUsernames.join(", ") })}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
