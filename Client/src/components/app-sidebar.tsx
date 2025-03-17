import * as React from "react";
import { useEffect, useState } from "react";
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  Frame,
  GalleryVerticalEnd,
  LogOut,
  Map,
  PieChart,
  Settings2,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { config } from "@/lib/config";
import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// This is sample data.
const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  teams: [
    {
      name: "Acme Inc",
      logo: GalleryVerticalEnd,
      plan: "Enterprise",
    },
    {
      name: "Acme Corp.",
      logo: AudioWaveform,
      plan: "Startup",
    },
    {
      name: "Evil Corp.",
      logo: Command,
      plan: "Free",
    },
  ],
  navMain: [
    // {
    //   title: "Playground",
    //   url: "#",
    //   icon: SquareTerminal,
    //   isActive: true,
    //   items: [
    //     {
    //       title: "History",
    //       url: "#",
    //     },
    //     {
    //       title: "Starred",
    //       url: "#",
    //     },
    //     {
    //       title: "Settings",
    //       url: "#",
    //     },
    //   ],
    // },
    {
      title: "Models",
      url: "#",
      icon: Bot,
      items: [
        {
          title: "Genesis",
          url: "#",
        },
        {
          title: "Explorer",
          url: "#",
        },
        {
          title: "Quantum",
          url: "#",
        },
      ],
    },
    {
      title: "Documentation",
      url: "#",
      icon: BookOpen,
      items: [
        {
          title: "Introduction",
          url: "#",
        },
        {
          title: "Get Started",
          url: "#",
        },
        {
          title: "Tutorials",
          url: "#",
        },
        {
          title: "Changelog",
          url: "#",
        },
      ],
    },
    {
      title: "Settings",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Team",
          url: "#",
        },
        {
          title: "Billing",
          url: "#",
        },
        {
          title: "Limits",
          url: "#",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
      icon: Frame,
    },
    {
      name: "Sales & Marketing",
      url: "#",
      icon: PieChart,
    },
    {
      name: "Travel",
      url: "#",
      icon: Map,
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const navigate = useNavigate();
  const { logout, user: authUser } = useAuth();
  const [firebaseUser, setFirebaseUser] = useState(auth.currentUser);

  // Listen for Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
    });

    return () => unsubscribe();
  }, []);

  // Determine which user data to use
  const userData =
    authUser ||
    (firebaseUser
      ? {
          name: firebaseUser.displayName || "User",
          email: firebaseUser.email || "user@example.com",
          avatar: firebaseUser.photoURL || "",
        }
      : null);

  const { isMobile, state } = useSidebar();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavUser user={userData} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        {/* <NavProjects projects={data.projects} /> */}
      </SidebarContent>
      <SidebarFooter>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  try {
                    // Clear avatar from localStorage and sessionStorage
                    localStorage.removeItem("userAvatar");
                    sessionStorage.removeItem("userAvatar");
                    localStorage.removeItem("avatarUrl");
                    sessionStorage.removeItem("avatarUrl");

                    // Clear any cookies that might store avatar data
                    document.cookie =
                      "userAvatar=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                    document.cookie =
                      "avatarUrl=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

                    // Force browser to clear image cache for this user
                    if (userData && userData.avatar) {
                      const img = new Image();
                      img.src =
                        userData.avatar + "?clear=" + new Date().getTime();
                    }

                    await fetch(`${config.api.baseUrl}/api/auth/logout`, {
                      method: "POST",
                      credentials: "include",
                    });
                    await logout();
                    navigate("/login");
                  } catch (error) {
                    console.error("Logout failed:", error);
                  }
                }}
                className="group-data-[state=collapsed]:w-8 group-data-[state=collapsed]:h-8 group-data-[state=collapsed]:p-0 group-data-[state=collapsed]:flex group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:items-center group-data-[state=collapsed]:mx-auto group-data-[state=collapsed]:ml-[calc(50%-20px)] transition-all"
              >
                <LogOut className="h-4 w-4 mr-2 group-data-[state=collapsed]:mr-0" />
                <span className="group-data-[state=collapsed]:hidden">
                  Logout
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              align="center"
              hidden={state !== "collapsed" || isMobile}
            >
              Logout
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </SidebarFooter>
    </Sidebar>
  );
}
