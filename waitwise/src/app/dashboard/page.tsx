'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from "@/components/ui/button"
import { CreateShopForm } from "@/components/ui/CreateShopForm"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
// --- FIX: Removed unused 'DialogTrigger' ---
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Trash2, Edit, RefreshCw, QrCode, CreditCard, Wand2, ListPlus, UserPlus, MoreVertical } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import QRCode from 'qrcode';
import { toast } from "sonner"


type QueueEntry = {
  id: string;
  client_name: string;
  queue_position: number;
  status: 'waiting' | 'in_progress' | 'done' | 'no_show';
  created_at: string; 
  barbers: { id: string; name: string; } | null;
  queue_entry_services: {
    services: { id: string; name: string; price: number; } | null
  }[] | null;
}
type Shop = {
  id: string;
  name: string;
  address: string;
  owner_id: string;
  subscription_status: 'trial' | 'active' | 'past_due' | null;
  stripe_customer_id: string | null;
  opening_time: string | null;
  closing_time: string | null;
  account_balance?: number;
}
type Service = { id:string; name: string; price: number; duration_minutes: number }
type Barber = { id: string; name: string; avatar_url: string | null }

// --- FIX: Created a type for our analytics data object ---
type AnalyticsData = {
  totalRevenue: number;
  totalCustomers: number;
  noShowRate: number;
  barberRevenueData: { name: string; revenue: number }[];
  barberClientData: { name: string; clients: number }[];
};


export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  
  const [shop, setShop] = useState<Shop | null>(null)
  const [loading, setLoading] = useState(true)
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [barbers, setBarbers] = useState<Barber[]>([])
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isBillingDialogOpen, setIsBillingDialogOpen] = useState(false)
  const [editingQueueEntry, setEditingQueueEntry] = useState<QueueEntry | null>(null);
  const [isEditQueueEntryDialogOpen, setIsEditQueueEntryDialogOpen] = useState(false);
  const [editedBarberId, setEditedBarberId] = useState('');
  const [editedShopName, setEditedShopName] = useState('')
  const [editedShopAddress, setEditedShopAddress] = useState('')
  const [editedOpeningTime, setEditedOpeningTime] = useState('');
  const [editedClosingTime, setEditedClosingTime] = useState('');
  const [newServiceName, setNewServiceName] = useState('')
  const [newServicePrice, setNewServicePrice] = useState('')
  const [newServiceDuration, setNewServiceDuration] = useState('')
  const [newBarberName, setNewBarberName] = useState('')
  const [newBarberAvatarFile, setNewBarberAvatarFile] = useState<File | null>(null)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [billableEventsCount, setBillableEventsCount] = useState(0);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [showAllNoShows, setShowAllNoShows] = useState(false);

  const [analyticsRange, setAnalyticsRange] = useState('today');
  // --- FIX: Applied the new type to the state ---
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true);

  const fetchQueueData = useCallback(async (shop: Shop) => {
    if (!shop) return;
    const { data, error } = await supabase
      .from('queue_entries')
      .select(`*, barbers ( id, name ), queue_entry_services ( services ( id, name, price ) )`)
      .eq('shop_id', shop.id)
      .in('status', ['waiting', 'in_progress'])
      .order('queue_position');
    
    if (error) {
      console.error("Error fetching queue:", error);
      return;
    }
    setQueueEntries(data as QueueEntry[]);
  }, [supabase]);

  useEffect(() => {
    async function fetchUserAndShop() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: shopData } = await supabase.from('shops').select('*').eq('owner_id', user.id).single();
      if (shopData) {
        setShop(shopData);
        setEditedShopName(shopData.name);
        setEditedShopAddress(shopData.address);
        setEditedOpeningTime(shopData.opening_time || '09:00');
        setEditedClosingTime(shopData.closing_time || '17:00');
      }
      setLoading(false);
    }
    fetchUserAndShop();
  }, [supabase, router]);

  useEffect(() => {
    if (!shop) return;

    const fetchAllShopData = async () => {
      const [
        { data: servicesData },
        { data: barbersData }
      ] = await Promise.all([
        supabase.from('services').select('*').eq('shop_id', shop.id).order('created_at'),
        supabase.from('barbers').select('id, name, avatar_url').eq('shop_id', shop.id).order('created_at')
      ]);
      setServices(servicesData || []);
      setBarbers(barbersData || []);
      fetchQueueData(shop);
    };

    fetchAllShopData();
  }, [shop, supabase, fetchQueueData]);

  useEffect(() => {
    if (!shop) return;
    const fetchBillableCount = async () => {
      const today = new Date();
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      
      const { count, error } = await supabase
        .from('billable_events')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .gte('created_at', firstDayOfMonth);

      if (error) {
        console.error("Error fetching billable events count:", error);
      } else {
        setBillableEventsCount(count || 0);
      }
    };
    fetchBillableCount();
  }, [shop, supabase]);

  useEffect(() => {
    if (!shop) return;
    const fetchAnalytics = async () => {
      setIsAnalyticsLoading(true);

      const today = new Date();
      // --- FIX: Changed `let endDate` to `const endDate` ---
      let startDate;
      const endDate = new Date();

      switch (analyticsRange) {
        case 'week':
          startDate = new Date(new Date().setDate(today.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(new Date().setMonth(today.getMonth() - 1));
          break;
        case 'all_time':
          startDate = new Date(0);
          break;
        case 'today':
        default:
          startDate = new Date(new Date().setHours(0, 0, 0, 0));
          break;
      }
      
      try {
        const { data, error } = await supabase.functions.invoke('get-analytics-data', {
          body: { 
            shop_id: shop.id, 
            startDate: startDate.toISOString(), 
            endDate: endDate.toISOString() 
          },
        });

        if (error) throw error;
        
        setAnalyticsData(data);
      } catch (error) {
        toast.error("Failed to load analytics data.");
        console.error("Analytics error:", error);
      } finally {
        setIsAnalyticsLoading(false);
      }
    };

    fetchAnalytics();
  }, [shop, analyticsRange, supabase]);

  useEffect(() => {
    if (!shop) return;
    const channel = supabase.channel(`queue_for_${shop.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `shop_id=eq.${shop.id}` }, () => fetchQueueData(shop))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entry_services' }, () => fetchQueueData(shop))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'billable_events', filter: `shop_id=eq.${shop.id}` }, () => {
        setBillableEventsCount(currentCount => currentCount + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, supabase, fetchQueueData]);

  useEffect(() => {
    if (!shop) return;
    const servicesChannel = supabase
      .channel(`services_for_${shop.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'services', filter: `shop_id=eq.${shop.id}`}, 
        (payload) => setServices((current) => [...current, payload.new as Service]))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'services', filter: `shop_id=eq.${shop.id}`},
        (payload) => setServices((current) => current.filter(s => s.id !== payload.old.id)))
      .subscribe();
    return () => { supabase.removeChannel(servicesChannel); };
  }, [shop, supabase]);

  useEffect(() => {
    if (!shop) return;
    const barbersChannel = supabase
      .channel(`barbers_for_${shop.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'barbers', filter: `shop_id=eq.${shop.id}`},
        (payload) => setBarbers((current) => [...current, payload.new as Barber]))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'barbers', filter: `shop_id=eq.${shop.id}`},
        (payload) => setBarbers((current) => current.filter(b => b.id !== payload.old.id)))
      .subscribe();
    return () => { supabase.removeChannel(barbersChannel); };
  }, [shop, supabase]);

  const fullCompletedList = useMemo(() => queueEntries.filter(e => e.status === 'done').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [queueEntries]);
  const fullNoShowList = useMemo(() => queueEntries.filter(e => e.status === 'no_show').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [queueEntries]);
  
  const visibleCompletedList = useMemo(() => showAllCompleted ? fullCompletedList : fullCompletedList.slice(0, 5), [fullCompletedList, showAllCompleted]);
  const visibleNoShowList = useMemo(() => showAllNoShows ? fullNoShowList : fullNoShowList.slice(0, 5), [fullNoShowList, showAllNoShows]);
  
  const barberColorMap = useMemo(() => {
    const VIBRANT_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
    const map: { [key: string]: string } = {};
    barbers.forEach((barber, index) => {
      map[barber.name] = VIBRANT_COLORS[index % VIBRANT_COLORS.length];
    });
    return map;
  }, [barbers]);

  const handleRequeue = async (entry: QueueEntry) => {
    if (!entry.barbers?.id) {
      toast.error("This client has no assigned barber and cannot be re-queued.");
      return;
    }
    const { data: waitingEntries, error: fetchError } = await supabase
      .from('queue_entries')
      .select('queue_position')
      .eq('barber_id', entry.barbers.id)
      .eq('status', 'waiting')
      .order('queue_position', { ascending: true })
      .limit(1);

    if (fetchError) {
      console.error("Error fetching waiting queue:", fetchError);
      toast.error("Could not retrieve the current queue. Please try again.");
      return;
    }
    const newPosition = waitingEntries && waitingEntries.length > 0 ? waitingEntries[0].queue_position - 1 : 1;
    const { error: updateError } = await supabase
      .from('queue_entries')
      .update({ status: 'waiting', queue_position: newPosition })
      .eq('id', entry.id);

    if (updateError) {
      console.error("Error re-queuing client:", updateError);
      toast.error("Failed to re-queue the client.");
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: QueueEntry['status']) => {
    if (newStatus === 'done' && shop) {
      const { error: billableError } = await supabase
        .from('billable_events')
        .insert({ shop_id: shop.id, queue_entry_id: id });

      if (billableError) {
        console.error("Could not create billable event:", billableError);
        toast.warning("Could not log this event for billing. Please contact support.");
      }
    }
    await supabase.from('queue_entries').update({ status: newStatus }).eq('id', id);
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/') }
  
  const handleDeleteFromQueue = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this entry?")) return;
    try {
      await supabase.from('queue_entries').delete().eq('id', id).throwOnError();
    } catch (error) {
      console.error("Delete queue entry error:", error);
      toast.error("Could not delete this entry.");
    }
  }

  const handleOpenEditDialog = (entry: QueueEntry) => {
    if (entry.barbers) {
      setEditingQueueEntry(entry);
      setEditedBarberId(entry.barbers.id);
      setIsEditQueueEntryDialogOpen(true);
    } else {
      toast.error("This entry has no barber assigned to edit.");
    }
  }

  const handleUpdateQueueEntry = async () => {
    if (!editingQueueEntry) return;
    
    const { error } = await supabase
      .from('queue_entries')
      .update({ barber_id: editedBarberId })
      .eq('id', editingQueueEntry.id);
    
    if (error) {
      toast.error(`Error updating barber: ${error.message}`);
      return;
    }
    setIsEditQueueEntryDialogOpen(false);
    setEditingQueueEntry(null);
  }

  const handleUpdateShopDetails = async () => {
    if (!shop) return;
    const { data: updatedShop, error } = await supabase
      .from('shops')
      .update({ 
          name: editedShopName, 
          address: editedShopAddress,
          opening_time: editedOpeningTime,
          closing_time: editedClosingTime
      })
      .eq('id', shop.id)
      .select()
      .single();

    if (error) {
      toast.error(`Failed to update shop details: ${error.message}`);
      return;
    }
    if (updatedShop) {
        setShop(updatedShop);
        toast.success("Shop details updated!");
    }
  };

  const handleAddService = async () => {
    if (!shop || !newServiceName || !newServicePrice || !newServiceDuration) return;
    const { error } = await supabase.from('services').insert({ name: newServiceName, price: parseFloat(newServicePrice), duration_minutes: parseInt(newServiceDuration), shop_id: shop.id });
    if (!error) { 
      setNewServiceName(''); 
      setNewServicePrice(''); 
      setNewServiceDuration(''); 
      toast.success("Service added!");
    } else {
      toast.error("Failed to add service.");
    }
  };

  const handleDeleteService = async (serviceId: string) => {
    if (!confirm("Are you sure you want to delete this service?")) return;
    try {
      await supabase.from('services').delete().eq('id', serviceId).throwOnError();
      toast.success("Service deleted.");
    } catch (error) {
      console.error("Delete service error:", error);
      toast.error("Could not delete service. It may be linked to historical queue entries.");
    }
  };

  const handleAddBarber = async () => {
    if (!shop || !newBarberName) return;
    let avatarUrl: string | null = null;
    if (newBarberAvatarFile) {
      const file = newBarberAvatarFile;
      const fileExt = file.name.split('.').pop();
      const filePath = `${shop.id}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file);
      if (uploadError) {
        toast.error('Error uploading avatar. Please try again.');
        return;
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      avatarUrl = data.publicUrl;
    }
    const { error } = await supabase.from('barbers').insert({ name: newBarberName, avatar_url: avatarUrl, shop_id: shop.id });
    if (!error) { 
      setNewBarberName('');
      setNewBarberAvatarFile(null);
      const fileInput = document.getElementById('new-barber-avatar') as HTMLInputElement;
      if(fileInput) fileInput.value = '';
      toast.success("Barber added!");
    } else {
      toast.error("Failed to add barber.");
    }
  };
  const handleDeleteBarber = async (barberId: string) => {
    if (!confirm("Are you sure you want to delete this barber?")) return;
    try {
      await supabase.from('barbers').delete().eq('id', barberId).throwOnError();
      toast.success("Barber deleted.");
    } catch (error) {
      console.error("Delete barber error:", error);
      toast.error("Could not delete barber. They may be linked to historical queue entries.");
    }
  };
  
  const generateQRCode = async () => {
    if (!shop) return;
    const url = `${window.location.origin}/shop/${shop.id}`;
    try {
      const options = {
        errorCorrectionLevel: 'H' as const,
        type: 'image/png' as const,
        margin: 1,
        color: {
          dark:"#000000",
          light:"#FFFFFF"
        }
      };
      const dataUrl = await QRCode.toDataURL(url, options);
      setQrCodeDataUrl(dataUrl);
    } catch (err) {
      console.error('Failed to generate QR code', err);
      toast.error('Could not generate QR code. Please try again.');
    }
  };

  const handleCreatePortal = async () => {
    if (!shop) return;
    try {
      const { data, error } = await supabase.functions.invoke('create-stripe-portal', {
        body: { shop_id: shop.id },
      });
      if (error) throw error;
      window.location.href = data.url;
    } catch (error) {
      if (error instanceof Error) {
        toast.error(`Error creating billing portal: ${error.message}`);
      } else {
        toast.error('An unknown error occurred while creating the billing portal.');
      }
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><p>Loading...</p></div>;
  }

  if (!shop) {
    return <CreateShopForm onShopCreated={setShop} />;
  }

  const isTrial = shop.subscription_status === 'trial' || shop.subscription_status === null;
  const trialUsages = 100 - billableEventsCount;

  return (
    <>
      <div className="container mx-auto p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-bold tracking-tight">{shop.name} - Live View</h1>
          
          <div className="hidden md:flex items-center gap-2">
            <Link href={`/shop/${shop.id}`} target="_blank"><Button variant="outline">Join Queue</Button></Link>
            <Button variant="outline" onClick={() => setIsBillingDialogOpen(true)}>Billing & Subscription</Button>
            <Button onClick={() => setIsEditDialogOpen(true)}>Edit Shop</Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>Logout</Button>
          </div>

          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => window.open(`/shop/${shop.id}`, '_blank')}>Join Queue Page</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsEditDialogOpen(true)}>Edit Shop</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsBillingDialogOpen(true)}>Billing & Subscription</DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <Dialog open={isBillingDialogOpen} onOpenChange={setIsBillingDialogOpen}>
            <DialogContent>
                <DialogHeader>
                  <DialogTitle>Billing & Subscription</DialogTitle>
                  <DialogDescription>
                    Manage your subscription and view usage.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <div className="flex justify-between items-center p-4 bg-muted rounded-lg">
                    <div>
                      <p className="text-sm font-medium">Current Plan</p>
                      <p className="text-2xl font-bold capitalize">{shop.subscription_status || 'Trial'}</p>
                    </div>
                    <Button onClick={handleCreatePortal}>
                      <CreditCard className="mr-2 h-4 w-4"/> Manage Billing
                    </Button>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button type="button" variant="secondary">Close</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                <DialogTitle>Edit {editedShopName}</DialogTitle>
                <DialogDescription>Update your shop details, services, barbers, and get your QR code here.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <Card>
                  <CardHeader><CardTitle>Shop Details</CardTitle></CardHeader>
                  <CardContent className="grid gap-4">
                      <div className="grid gap-2"><Label htmlFor="name">Shop Name</Label><Input id="name" value={editedShopName} onChange={(e) => setEditedShopName(e.target.value)} /></div>
                      <div className="grid gap-2"><Label htmlFor="address">Shop Address</Label><Input id="address" value={editedShopAddress} onChange={(e) => setEditedShopAddress(e.target.value)} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="opening-time">Opening Time</Label>
                          <Input id="opening-time" type="time" value={editedOpeningTime} onChange={e => setEditedOpeningTime(e.target.value)} />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="closing-time">Closing Time</Label>
                          <Input id="closing-time" type="time" value={editedClosingTime} onChange={e => setEditedClosingTime(e.target.value)} />
                        </div>
                      </div>
                  </CardContent>
                  <CardFooter><Button onClick={handleUpdateShopDetails}>Save Shop Details</Button></CardFooter>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Shop QR Code</CardTitle>
                        <CardDescription>
                            Customers can scan this code to go directly to your booking page.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center gap-4">
                        {qrCodeDataUrl ? (
                            <Image src={qrCodeDataUrl} alt="Shop QR Code" width={192} height={192} className="border rounded-lg" />
                        ) : (
                            <div className="w-48 h-48 border rounded-lg bg-muted flex items-center justify-center">
                                <p className="text-sm text-muted-foreground">Click to generate</p>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <Button onClick={generateQRCode} variant="outline">
                                <QrCode className="mr-2 h-4 w-4" />
                                {qrCodeDataUrl ? 'Regenerate' : 'Generate'} QR Code
                            </Button>
                            {qrCodeDataUrl && (
                                <a href={qrCodeDataUrl} download={`${editedShopName}-QRCode.png`}>
                                    <Button>Download</Button>
                                </a>
                            )}
                        </div>
                    </CardContent>
                </Card>
                
               <Card>
                   <CardHeader><CardTitle>Manage Services</CardTitle></CardHeader>
                   <CardContent>
                   {services.length > 0 ? (
                       <Table>
                           <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Price</TableHead><TableHead>Mins</TableHead><TableHead></TableHead></TableRow></TableHeader>
                           <TableBody>
                               {services.map(s => (
                                   <TableRow key={s.id}>
                                       <TableCell>{s.name}</TableCell>
                                       <TableCell>${s.price}</TableCell>
                                       <TableCell>{s.duration_minutes}</TableCell>
                                       <TableCell className="text-right">
                                           <Button variant="ghost" size="icon" onClick={() => handleDeleteService(s.id)}>
                                               <Trash2 className="h-4 w-4" />
                                           </Button>
                                       </TableCell>
                                   </TableRow>
                               ))}
                           </TableBody>
                       </Table>
                   ) : (
                       <div className="text-center p-6 border-2 border-dashed rounded-lg">
                           <ListPlus className="mx-auto h-12 w-12 text-muted-foreground" />
                           <h3 className="mt-4 text-lg font-semibold">No Services Added Yet</h3>
                           <p className="mt-1 text-sm text-muted-foreground">
                               Add your first service below to make it available for customers.
                           </p>
                       </div>
                   )}
                   </CardContent>
                   <CardFooter className="flex flex-wrap gap-2 items-end">
                       <div className="grid gap-1.5 flex-grow min-w-[120px]"><Label htmlFor="new-service-name">New Service</Label><Input id="new-service-name" placeholder="Name" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} /></div>
                       <div className="grid gap-1.5 w-24"><Label htmlFor="new-service-price">Price</Label><Input id="new-service-price" type="number" placeholder="$" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)} /></div>
                       <div className="grid gap-1.5 w-24"><Label htmlFor="new-service-duration">Mins</Label><Input id="new-service-duration" type="number" placeholder="Time" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)} /></div>
                       <Button onClick={handleAddService}>Add</Button>
                   </CardFooter>
               </Card>
               <Card>
                   <CardHeader><CardTitle>Manage Barbers</CardTitle></CardHeader>
                   <CardContent>
                   {barbers.length > 0 ? (
                       <Table>
                           <TableHeader><TableRow><TableHead>Barber</TableHead><TableHead></TableHead></TableRow></TableHeader>
                           <TableBody>
                               {barbers.map(b => (
                                   <TableRow key={b.id}>
                                       <TableCell className="flex items-center gap-4">
                                           <Avatar>
                                               <AvatarImage src={b.avatar_url || undefined} alt={b.name} />
                                               <AvatarFallback>{b.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                                           </Avatar>
                                           {b.name}
                                       </TableCell>
                                       <TableCell className="text-right">
                                           <Button variant="ghost" size="icon" onClick={() => handleDeleteBarber(b.id)}>
                                               <Trash2 className="h-4 w-4" />
                                           </Button>
                                       </TableCell>
                                   </TableRow>
                               ))}
                           </TableBody>
                       </Table>
                   ) : (
                       <div className="text-center p-6 border-2 border-dashed rounded-lg">
                           <UserPlus className="mx-auto h-12 w-12 text-muted-foreground" />
                           <h3 className="mt-4 text-lg font-semibold">No Barbers Added Yet</h3>
                           <p className="mt-1 text-sm text-muted-foreground">
                               Add your first barber below. Each barber will have their own queue.
                           </p>
                       </div>
                   )}
                   </CardContent>
                   <CardFooter className="flex flex-col gap-4 items-start">
                       <div className="grid gap-1.5 w-full">
                           <Label htmlFor="new-barber-name">New Barber Name</Label>
                           <Input id="new-barber-name" placeholder="e.g., John Smith" value={newBarberName} onChange={e => setNewBarberName(e.target.value)} />
                       </div>
                       <div className="grid gap-1.5 w-full">
                           <Label htmlFor="new-barber-avatar">Avatar</Label>
                           <Input id="new-barber-avatar" type="file" accept="image/*" onChange={(e) => e.target.files && setNewBarberAvatarFile(e.target.files[0])} />
                       </div>
                       <Button onClick={handleAddBarber}>Add Barber</Button>
                   </CardFooter>
               </Card>
              </div>
              <DialogFooter><DialogClose asChild><Button type="button" variant="secondary">Close</Button></DialogClose></DialogFooter>
             </DialogContent>
        </Dialog>

        <Card className="mb-6">
            <CardHeader>
                <CardTitle>Usage This Month</CardTitle>
            </CardHeader>
            <CardContent>
                {isTrial ? (
                    <div>
                        <p className="text-2xl font-bold">{trialUsages > 0 ? trialUsages : 0}</p>
                        <p className="text-sm text-muted-foreground">free trial usages remaining.</p>
                        {trialUsages <= 0 && <p className="text-sm text-red-500 mt-2">You have used all your free trial clients! Please upgrade to continue.</p>}
                    </div>
                ) : (
                    <div>
                        <p className="text-2xl font-bold">{billableEventsCount}</p>
                        <p className="text-sm text-muted-foreground">billable clients this month.</p>
                    </div>
                )}
            </CardContent>
        </Card>

        <Separator />
        
        {loading === false && barbers.length === 0 ? (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-6 w-6" />
                Welcome! Let&apos;s Get You Set Up.
              </CardTitle>
              <CardDescription>
                Your live queue view will appear here once you&apos;ve added your barbers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="font-semibold">Follow these simple steps:</p>
                <div className="flex items-start gap-4 p-4 bg-muted rounded-lg">
                  <div className="bg-primary text-primary-foreground rounded-full h-8 w-8 flex items-center justify-center font-bold flex-shrink-0">1</div>
                  <div>
                    <h4 className="font-bold">Click &quot;Edit Shop&quot;</h4>
                    <p className="text-sm text-muted-foreground">Open the main settings panel by clicking the &quot;Edit Shop&quot; button in the top-right corner.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 bg-muted rounded-lg">
                  <div className="bg-primary text-primary-foreground rounded-full h-8 w-8 flex items-center justify-center font-bold flex-shrink-0">2</div>
                  <div>
                    <h4 className="font-bold">Add Services & Barbers</h4>
                    <p className="text-sm text-muted-foreground">In the dialog, add the services you offer and the barbers on your team. Each barber will get their own dedicated queue.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 bg-muted rounded-lg">
                  <div className="bg-primary text-primary-foreground rounded-full h-8 w-8 flex items-center justify-center font-bold flex-shrink-0">3</div>
                  <div>
                    <h4 className="font-bold">Share Your QR Code</h4>
                    <p className="text-sm text-muted-foreground">Generate your shop&apos;s unique QR code from the &quot;Edit Shop&quot; panel and share it with your customers so they can join the queue!</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="mt-8 grid gap-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {barbers.map(barber => {
                const barberQueue = queueEntries.filter(entry => entry.barbers?.id === barber.id);
                const waitingForBarber = barberQueue.filter(entry => entry.status === 'waiting');
                const inProgressWithBarber = barberQueue.find(entry => entry.status === 'in_progress');
                return (
                  <div key={barber.id} className="space-y-4">
                    <h2 className="text-xl font-semibold">{barber.name}</h2>
                    <Card className={inProgressWithBarber ? "border-primary" : "border-transparent shadow-none"}>
                      {inProgressWithBarber ? (
                        <>
                          <CardHeader>
                            <CardTitle className="flex justify-between items-start">
                              <span>{inProgressWithBarber.client_name}</span>
                              <Badge variant="destructive" className="dark:text-black">In Progress</Badge>
                            </CardTitle>
                            <CardDescription>
                              Services: {
                                inProgressWithBarber.queue_entry_services && inProgressWithBarber.queue_entry_services.length > 0
                                  ? inProgressWithBarber.queue_entry_services
                                      .map(item => item.services?.name)
                                      .filter(Boolean)
                                      .join(', ')
                                  : 'No services listed'
                              }
                            </CardDescription>
                          </CardHeader>
                          <CardFooter className="flex justify-end">
                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus(inProgressWithBarber.id, 'done')}>Mark as Done</Button>
                          </CardFooter>
                        </>
                      ) : (
                        <CardContent className="pt-6">
                          <p className="text-sm text-center text-muted-foreground">Available</p>
                        </CardContent>
                      )}
                    </Card>
                    <Separator />
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Badge variant="secondary">{waitingForBarber.length}</Badge>
                        Waiting
                      </h3>
                      {waitingForBarber.map((entry, index) => (
                        <Card key={entry.id}>
                          <CardHeader className="p-4">
                            <CardTitle className="text-base flex justify-between items-start">
                              <span className="font-semibold">{index + 1}. {entry.client_name}</span>
                              <div className="flex gap-1 flex-shrink-0">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEditDialog(entry)}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleUpdateStatus(entry.id, 'no_show')}><Trash2 className="h-4 w-4" /></Button>
                                <Button variant="outline" size="sm" onClick={() => handleUpdateStatus(entry.id, 'in_progress')} disabled={!!inProgressWithBarber || (isTrial && trialUsages <= 0)}>Start</Button>
                              </div>
                            </CardTitle>
                            <CardDescription className="text-xs pt-1">
                              {
                                entry.queue_entry_services && entry.queue_entry_services.length > 0
                                  ? entry.queue_entry_services.map(item => item.services?.name).filter(Boolean).join(', ')
                                  : 'No services listed'
                              }
                            </CardDescription>
                          </CardHeader>
                        </Card>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            
            <div className="mt-8 grid gap-8 grid-cols-1 lg:grid-cols-2 xl:col-span-3">
              <Card className="bg-muted/50">
                <CardHeader><CardTitle>Completed Today</CardTitle></CardHeader>
                <CardContent>
                  {visibleCompletedList.length > 0 ? (
                    <div className="space-y-4">
                        {visibleCompletedList.map((entry, index) => (
                          <div key={entry.id} className="flex items-center justify-between text-sm"><p>{index + 1}. {entry.client_name} <span className="text-muted-foreground">with {entry.barbers?.name || 'N/A'}</span></p><Badge variant={'default'}>Done</Badge></div>
                        ))}
                    </div>
                  ) : (<p className="text-sm text-center text-muted-foreground">No clients have been marked as done yet.</p>)}
                  {fullCompletedList.length > 5 && !showAllCompleted && (
                    <Button variant="link" className="w-full mt-4" onClick={() => setShowAllCompleted(true)}>
                      See all {fullCompletedList.length}
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-muted/50">
                <CardHeader><CardTitle>No-Shows</CardTitle></CardHeader>
                <CardContent>
                  {visibleNoShowList.length > 0 ? (
                    <div className="space-y-4">
                      {visibleNoShowList.map((entry, index) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm">
                          <p>{index + 1}. {entry.client_name} <span className="text-muted-foreground">with {entry.barbers?.name || 'N/A'}</span></p>
                          <div className="flex items-center gap-2">
                            <Badge variant={'secondary'}>No Show</Badge>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Re-queue Client" onClick={() => handleRequeue(entry)}>
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Delete Entry" onClick={() => handleDeleteFromQueue(entry.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (<p className="text-sm text-center text-muted-foreground">No clients have been marked as a no-show.</p>)}
                  {fullNoShowList.length > 5 && !showAllNoShows && (
                     <Button variant="link" className="w-full mt-4" onClick={() => setShowAllNoShows(true)}>
                      See all {fullNoShowList.length}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="mt-8 xl:col-span-3">
              <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
                <div>
                  <Select value={analyticsRange} onValueChange={setAnalyticsRange}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select a range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="week">This Week</SelectItem>
                      <SelectItem value="month">This Month</SelectItem>
                      <SelectItem value="all_time">All Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isAnalyticsLoading ? (
                  <p className="text-center text-muted-foreground">Loading analytics...</p>
              ) : analyticsData ? (
                <>
                  <div className="grid gap-4 md:grid-cols-3 mb-8">
                    <Card>
                      <CardHeader><CardTitle>Total Revenue</CardTitle></CardHeader>
                      <CardContent><p className="text-2xl font-bold">${(analyticsData.totalRevenue || 0).toFixed(2)}</p></CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>Customers Served</CardTitle></CardHeader>
                      <CardContent><p className="text-2xl font-bold">{analyticsData.totalCustomers || 0}</p></CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>No-Show Rate</CardTitle></CardHeader>
                      <CardContent><p className="text-2xl font-bold">{(analyticsData.noShowRate || 0).toFixed(1)}%</p></CardContent>
                    </Card>
                  </div>
                  
                  <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
                    <Card>
                      <CardHeader><CardTitle>Revenue per Barber</CardTitle></CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={analyticsData.barberRevenueData || []} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tickFormatter={(value) => `$${value}`} />
                            <YAxis type="category" dataKey="name" width={80} />
                            <Tooltip formatter={(value: number) => `$${Number(value).toFixed(2)}`} />
                            <Bar dataKey="revenue" name="Total Revenue">
                              {/* --- FIX: Added type annotation for entry --- */}
                              {(analyticsData.barberRevenueData || []).map((entry: { name: string }) => (
                                <Cell key={`cell-${entry.name}`} fill={barberColorMap[entry.name] || '#8884d8'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle>Clients per Barber</CardTitle></CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={analyticsData.barberClientData || []}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={90}
                                    fill="#8884d8"
                                    paddingAngle={5}
                                    dataKey="clients"
                                    nameKey="name"
                                    label={({ name, clients }) => `${name}: ${clients}`}
                                >
                                    {/* --- FIX: Added type annotation for entry --- */}
                                    {(analyticsData.barberClientData || []).map((entry: { name: string }) => (
                                        <Cell key={`cell-${entry.name}`} fill={barberColorMap[entry.name] || '#8884d8'} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>
                </>
              ) : (
                <p className="text-center text-muted-foreground">No analytics data available for this period.</p>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={isEditQueueEntryDialogOpen} onOpenChange={setIsEditQueueEntryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Queue for {editingQueueEntry?.client_name}</DialogTitle>
            <DialogDescription>Change the assigned barber for this client.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="barber-select">Change Barber</Label>
              <Select value={editedBarberId} onValueChange={setEditedBarberId}>
                <SelectTrigger id="barber-select">
                  <SelectValue placeholder="Select a barber" />
                </SelectTrigger>
                <SelectContent>
                  {barbers.map(barber => (
                    <SelectItem key={barber.id} value={barber.id}>{barber.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={handleUpdateQueueEntry}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}