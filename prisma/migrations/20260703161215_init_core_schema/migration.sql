-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('FUNCTION', 'CLASS', 'METHOD', 'INTERFACE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "githubId" INTEGER NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "avatarUrl" TEXT,
    "githubAccessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "repoUrl" TEXT,
    "currentBranch" VARCHAR(100) NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanvasState" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeModule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "filePath" TEXT NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeEntity" (
    "id" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "EntityType" NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "rawCode" TEXT NOT NULL,

    CONSTRAINT "CodeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceToken" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "Workspace_userId_idx" ON "Workspace"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CanvasState_workspaceId_key" ON "CanvasState"("workspaceId");

-- CreateIndex
CREATE INDEX "CanvasState_nodes_idx" ON "CanvasState" USING GIN ("nodes" jsonb_ops);

-- CreateIndex
CREATE INDEX "CodeModule_workspaceId_idx" ON "CodeModule"("workspaceId");

-- CreateIndex
CREATE INDEX "CodeModule_filePath_idx" ON "CodeModule"("filePath");

-- CreateIndex
CREATE INDEX "CodeEntity_moduleId_name_idx" ON "CodeEntity"("moduleId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceToken_token_key" ON "WorkspaceToken"("token");

-- CreateIndex
CREATE INDEX "WorkspaceToken_workspaceId_idx" ON "WorkspaceToken"("workspaceId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanvasState" ADD CONSTRAINT "CanvasState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeModule" ADD CONSTRAINT "CodeModule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeEntity" ADD CONSTRAINT "CodeEntity_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CodeModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceToken" ADD CONSTRAINT "WorkspaceToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
