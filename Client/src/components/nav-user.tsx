"use client";

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Sparkles,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { config } from "@/lib/config";

export function NavUser({
  user = null,
}: {
  user?: {
    name?: string;
    email?: string;
    avatar?: string;
  } | null;
}) {
  const { isMobile } = useSidebar();
  const { user: authUser, logout } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState(auth.currentUser);
  const navigate = useNavigate();

  // Listen for Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });

    return () => unsubscribe();
  }, []);

  // Modify the userData object to ensure we're not using any cached avatar
  let userData = {
    name: user?.name || authUser?.name || firebaseUser?.displayName || "User",
    email:
      user?.email ||
      authUser?.email ||
      firebaseUser?.email ||
      "user@example.com",
    // Check if this is a new login session and clear avatar if needed
    avatar: "", // Start with empty avatar
  };

  // Only set avatar if we're sure it belongs to the current user
  if (firebaseUser?.photoURL && firebaseUser?.email === userData.email) {
    userData.avatar = firebaseUser.photoURL;
  } else if (user?.avatar && user?.email === userData.email) {
    userData.avatar = user.avatar;
  } else if (authUser?.avatar && authUser?.email === userData.email) {
    userData.avatar = authUser.avatar;
  }

  // Generate initials for avatar fallback
  const initials = userData.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  // Create a unique avatar URL based on the user's email to prevent cross-user caching
  const avatarUrl = useMemo(() => {
    if (!userData.avatar || !userData.email) return "";

    // Create a stable but unique URL for this user session
    return `${userData.avatar.split("?")[0]}?email=${encodeURIComponent(
      userData.email
    )}&uid=${encodeURIComponent(firebaseUser?.uid || "")}`;
  }, [userData.avatar, userData.email, firebaseUser?.uid]);

  // Set to true to show avatars
  const showAvatar = true;

  // Add this function to handle avatar loading errors
  const handleAvatarError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    console.error("Avatar image failed to load:", avatarUrl);
    const imgElement = e.currentTarget as HTMLImageElement;
    imgElement.style.display = "none";

    // Find and show fallback
    const fallback = imgElement.parentElement?.querySelector(
      '[data-slot="avatar-fallback"]'
    ) as HTMLElement | null;

    if (fallback) {
      fallback.style.display = "flex";
    }

    // Clear the problematic avatar URL from storage
    if (firebaseUser) {
      import("firebase/auth").then(({ updateProfile }) => {
        updateProfile(firebaseUser, {
          photoURL: "",
        }).catch((err: Error) =>
          console.error("Failed to clear photoURL:", err)
        );
      });
    }
  };

  // console.log("Using avatar URL:", avatarUrl, "User data:", userData); // Enhanced debug log

  const handleLogout = async () => {
    try {
      // Clear avatar URL from state and storage
      setFirebaseUser(null);

      // Clear ALL possible avatar storage locations
      localStorage.removeItem("userAvatar");
      sessionStorage.removeItem("userAvatar");
      localStorage.removeItem("avatarUrl");
      sessionStorage.removeItem("avatarUrl");
      localStorage.removeItem("user_avatar");
      sessionStorage.removeItem("user_avatar");
      localStorage.removeItem("firebase:authUser");
      sessionStorage.removeItem("firebase:authUser");

      // Clear any cookies that might store avatar data
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i];
        const eqPos = cookie.indexOf("=");
        const name =
          eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
        document.cookie =
          name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;";
      }

      // Force browser to clear image cache for this user
      if (userData.avatar) {
        const img = new Image();
        img.src =
          userData.avatar +
          "?clear=" +
          new Date().getTime() +
          "&nocache=" +
          Math.random();

        // Try to update Firebase profile to remove photoURL
        if (firebaseUser) {
          try {
            // Import updateProfile function from firebase/auth
            const { updateProfile } = await import("firebase/auth");
            await updateProfile(firebaseUser, {
              photoURL: "",
            });
          } catch (profileError: unknown) {
            console.error("Failed to clear photoURL:", profileError);
          }
        }
      }

      // Sign out from Firebase
      await auth.signOut();

      // Call your backend logout endpoint
      await fetch(`${config.api.baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      // Call your auth context logout
      await logout();

      // Clear IndexedDB storage which might contain Firebase auth data
      const databases = await window.indexedDB.databases();
      databases.forEach((db) => {
        if (db.name) {
          window.indexedDB.deleteDatabase(db.name);
        }
      });

      // Navigate to login
      navigate("/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Add state to track dark mode
  const [isDarkMode, setIsDarkMode] = useState(
    document.documentElement.classList.contains("dark")
  );

  // Update dark mode state when theme changes
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };

    // Initial check
    checkDarkMode();

    // Set up observer for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class") {
          checkDarkMode();
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => {
      observer.disconnect();
    };
  }, []);

  // Button styles based on theme
  const buttonStyle = isDarkMode
    ? {
        backgroundColor: "#020618",
        color: "#e5e7eb",
        border: "1px solid #1f2937",
      }
    : {
        backgroundColor: "#e5e7eb",
        color: "#111827",
        border: "1px solid #d1d5db",
      };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              id="user-menu-button"
              style={buttonStyle}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                {showAvatar && avatarUrl ? (
                  <AvatarImage
                    src={avatarUrl}
                    alt={userData.name}
                    className="object-cover"
                    onError={handleAvatarError}
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                  />
                ) : (
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{userData.name}</span>
                <span className="truncate text-xs">{userData.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {showAvatar && avatarUrl ? (
                    <AvatarImage
                      src={avatarUrl}
                      alt={userData.name}
                      className="object-cover"
                      onError={handleAvatarError}
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <AvatarFallback className="rounded-lg">
                      {initials}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userData.name}</span>
                  <span className="truncate text-xs">{userData.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Sparkles />
                Upgrade to Pro
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
