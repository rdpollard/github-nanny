// Reused from cheney-yan/github-workflow-dashboard at 8b18dcb (MIT).
// Copyright (c) 2026 Cheney Yan; see licenses/github-workflow-dashboard.txt.
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
