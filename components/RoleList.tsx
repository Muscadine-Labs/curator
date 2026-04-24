'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExternalLink, Edit2, Check, X, Loader2 } from 'lucide-react';
import { Address, isAddress } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { v1WriteConfigs } from '@/lib/onchain/vault-writes';
import { BASE_CHAIN_ID } from '@/lib/constants';
import { useVaultRoles } from '@/lib/hooks/useVaultRoles';
import { logger } from '@/lib/utils/logger';

interface RoleListProps {
  vaultAddress: Address;
  chainId?: number;
}

export function RoleList({ vaultAddress, chainId = BASE_CHAIN_ID }: RoleListProps) {
  const { address: connectedAddress, isConnected } = useAccount();
  const { data: roles, isLoading } = useVaultRoles(vaultAddress, chainId);
  
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  // Write hooks for each role change
  const { writeContract: setCurator, data: curatorTxHash, isPending: isSettingCurator } = useWriteContract();
  const { writeContract: submitGuardian, data: guardianTxHash, isPending: isSubmittingGuardian } = useWriteContract();
  const { writeContract: acceptGuardian, data: acceptGuardianTxHash, isPending: isAcceptingGuardian } = useWriteContract();
  const { writeContract: transferOwnership, data: ownerTxHash, isPending: isTransferringOwner } = useWriteContract();

  // Wait for transaction receipts
  const { isLoading: isCuratorConfirming } = useWaitForTransactionReceipt({ hash: curatorTxHash });
  const { isLoading: isGuardianConfirming } = useWaitForTransactionReceipt({ hash: guardianTxHash });
  const { isLoading: isAcceptGuardianConfirming } = useWaitForTransactionReceipt({ hash: acceptGuardianTxHash });
  const { isLoading: isOwnerConfirming } = useWaitForTransactionReceipt({ hash: ownerTxHash });

  // Check if connected wallet has permission to change roles
  const canChangeOwner = isConnected && connectedAddress && roles?.owner?.toLowerCase() === connectedAddress.toLowerCase();
  const canChangeCurator = isConnected && connectedAddress && roles?.owner?.toLowerCase() === connectedAddress.toLowerCase();
  const canChangeGuardian = isConnected && connectedAddress && roles?.owner?.toLowerCase() === connectedAddress.toLowerCase();

  const handleEdit = (roleName: string, currentAddress: Address | null) => {
    setEditingRole(roleName);
    setEditValues({ [roleName]: currentAddress || '' });
  };

  const handleCancel = () => {
    setEditingRole(null);
    setEditValues({});
  };

  const handleSubmit = async (roleName: string) => {
    const newAddress = editValues[roleName]?.trim();
    if (!newAddress || !isAddress(newAddress)) {
      alert('Please enter a valid Ethereum address');
      return;
    }

    try {
      if (roleName === 'Owner') {
        const config = v1WriteConfigs.transferOwnership(vaultAddress, newAddress as Address);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transferOwnership(config as any);
      } else if (roleName === 'Curator') {
        const config = v1WriteConfigs.setCurator(vaultAddress, newAddress as Address);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setCurator(config as any);
      } else if (roleName === 'Guardian') {
        const config = v1WriteConfigs.submitGuardian(vaultAddress, newAddress as Address);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        submitGuardian(config as any);
      }
      setEditingRole(null);
      setEditValues({});
    } catch (error) {
      logger.error(`Failed to update ${roleName}`, error instanceof Error ? error : new Error(String(error)), {
        vaultAddress,
        roleName,
        newAddress,
      });
      alert(`Failed to update ${roleName}. Please try again.`);
    }
  };

  const handleAcceptGuardian = () => {
    const config = v1WriteConfigs.acceptGuardian(vaultAddress);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    acceptGuardian(config as any);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading roles...</div>
        </CardContent>
      </Card>
    );
  }

  if (!roles) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Failed to load roles</div>
        </CardContent>
      </Card>
    );
  }

  const roleItems = [
    {
      name: 'Owner',
      address: roles.owner,
      description: 'Safe multisig with protocol ownership',
      canEdit: canChangeOwner,
      isPending: isTransferringOwner || isOwnerConfirming,
    },
    {
      name: 'Guardian',
      address: roles.guardian,
      pendingAddress: roles.pendingGuardian,
      description: 'Safe multisig with guardian privileges',
      canEdit: canChangeGuardian,
      isPending: isSubmittingGuardian || isGuardianConfirming,
    },
    {
      name: 'Curator',
      address: roles.curator,
      description: 'Safe multisig with curator privileges',
      canEdit: canChangeCurator,
      isPending: isSettingCurator || isCuratorConfirming,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {roleItems.map((role) => {
          const isEditing = editingRole === role.name;
          const currentValue = editValues[role.name] || role.address || '';

          return (
            <div key={role.name} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <Badge variant="outline">{role.name}</Badge>
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={currentValue}
                        onChange={(e) => setEditValues({ ...editValues, [role.name]: e.target.value })}
                        placeholder="0x..."
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSubmit(role.name)}
                        disabled={role.isPending}
                      >
                        {role.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancel}
                        disabled={role.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      {role.address ? (
                        <span className="font-mono text-sm">{role.address}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not set</span>
                      )}
                      {role.pendingAddress && (
                        <Badge variant="secondary" className="text-xs">
                          Pending: {role.pendingAddress}
                        </Badge>
                      )}
                      {role.pendingAddress && role.canEdit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleAcceptGuardian}
                          disabled={isAcceptingGuardian || isAcceptGuardianConfirming}
                        >
                          {isAcceptingGuardian || isAcceptGuardianConfirming ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              Accepting...
                            </>
                          ) : (
                            'Accept Guardian'
                          )}
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {!isEditing && role.address && (
                  <a
                    href={`https://app.safe.global/home?safe=base:${role.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 ml-2"
                  >
                    Safe <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {!isEditing && role.canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(role.name, role.address)}
                    className="ml-2"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{role.description}</p>
            </div>
          );
        })}
        {!isConnected && (
          <div className="text-xs text-muted-foreground pt-2 border-t">
            Connect your wallet to edit roles
          </div>
        )}
      </CardContent>
    </Card>
  );
}
