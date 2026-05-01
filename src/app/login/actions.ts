"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  redirect("/inbox");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const fullName = formData.get("fullName") as string;
  const clinicName = formData.get("clinicName") as string;
  const clinicType = formData.get("clinicType") as string;
  const planType = formData.get("planType") as string;

  // Sign up the user with metadata.
  const { data, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        clinic_name: clinicName,
        clinic_type: clinicType,
        plan_type: planType,
      },
    },
  });

  if (authError) {
    redirect("/login?error=" + encodeURIComponent(authError.message));
  }

  if (data.session) {
    redirect("/inbox");
  }

  redirect(
    "/login?message=" +
      encodeURIComponent("Check your email to confirm your account, then sign in.")
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
