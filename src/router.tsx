import { createBrowserRouter, Navigate } from "react-router"
import { AppLayout } from "@/pages/AppLayout"
import { BotsPage } from "@/pages/BotsPage"
import { ChatPage } from "@/pages/ChatPage"
import { HistoryPage } from "@/pages/HistoryPage"
import { HomePage } from "@/pages/HomePage"
import { NotFoundPage } from "@/pages/NotFoundPage"
import { RequestsPage } from "@/pages/RequestsPage"
import { SignInPage } from "@/pages/SignInPage"

/** The pages of the app. It runs only in the browser. */
export const router = createBrowserRouter([
	{ path: "/sign-in", element: <SignInPage /> },
	{
		element: <AppLayout />,
		children: [
			{ index: true, element: <HomePage /> },
			{ path: "c/:chatId", element: <ChatPage /> },
			{ path: "bots", element: <BotsPage /> },
			// Agents are Bots now. Old links still work.
			{ path: "agents", element: <Navigate to="/bots" replace /> },
			{ path: "requests", element: <RequestsPage /> },
			{ path: "history", element: <HistoryPage /> },
		],
	},
	{ path: "*", element: <NotFoundPage /> },
])
