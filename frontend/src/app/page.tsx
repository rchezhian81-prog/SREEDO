"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { Spinner } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    // Unauthenticated visitors land on the campus selector (School / College)
    // before reaching the themed sign-in screen.
    router.replace(accessToken ? "/dashboard" : "/select");
  }, [accessToken, router]);

  return <Spinner />;
}
