'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Edit, RefreshCw, QrCode, CreditCard } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import QRCode from 'qrcode';


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
// --- NEW: Updated Shop type to include opening/closing times ---
type Shop = {
  id: string;
  name: string;
  address: string;
  owner_id: string;
  subscription_status: 'trial' | 'active' | 'past_due' | null;
  stripe_customer_id: string | null;
  opening_time: string | null;
  closing_time: string | null;
}
type Service = { id:string; name: string; price: number; duration_minutes: number }
type Barber = { id: string; name: string; avatar_url: string | null }


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
  // --- NEW: State for opening/closing time editors ---
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

  // --- NEW: Updated fetch function to filter by shop hours ---
  const fetchQueueData = useCallback(async (shop: Shop) => {
    if (!shop.opening_time || !shop.closing_time) {
        // If times aren't set, don't fetch any data
        console.log("Shop opening/closing times are not set.");
        return [];
    }
    const today = new Date().toISOString().slice(0, 10);
    // Construct start and end timestamps for today based on shop's local time
    const startTime = `${today}T${shop.opening_time}`;
    const endTime = `${today}T${shop.closing_time}`;

    const { data, error } = await supabase
      .from('queue_entries')
      .select(`*, barbers ( id, name ), queue_entry_services ( services ( id, name, price ) )`)
      .eq('shop_id', shop.id)
      .gte('created_at', startTime)
      .lte('created_at', endTime)
      .order('queue_position');
    
    if (error) {
      console.error("Error fetching queue:", error);
      return [];
    }
    return data as QueueEntry[];
  }, [supabase]);

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
    async function initialFetch() {
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
        // --- NEW: Set initial values for time editors ---
        setEditedOpeningTime(shopData.opening_time || '09:00');
        setEditedClosingTime(shopData.closing_time || '17:00');
        
        const [entriesData, { data: servicesData }, { data: barbersData }] = await Promise.all([
          fetchQueueData(shopData),
          supabase.from('services').select('*').eq('shop_id', shopData.id).order('created_at'),
          supabase.from('barbers').select('id, name, avatar_url').eq('shop_id', shopData.id).order('created_at')
        ]);
        setQueueEntries(entriesData);
        setServices(servicesData || []);
        setBarbers(barbersData || []);
      }
      setLoading(false);
    }
    initialFetch();
  }, [supabase, router, fetchQueueData]);

  useEffect(() => {
    if (!shop) return;
    const channel = supabase.channel(`queue_for_${shop.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `shop_id=eq.${shop.id}` }, async () => {
        const updatedQueue = await fetchQueueData(shop);
        setQueueEntries(updatedQueue);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entry_services' }, async () => {
        const updatedQueue = await fetchQueueData(shop);
        setQueueEntries(updatedQueue);
      })
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
  
  const barberClientCount = useMemo(() => {
    const counts = barbers.reduce((acc, barber) => {
      acc[barber.name] = 0;
      return acc;
    }, {} as { [key: string]: number });
    fullCompletedList.forEach(entry => {
      if(entry.barbers?.name) {
        counts[entry.barbers.name] = (counts[entry.barbers.name] || 0) + 1;
      }
    });
    return Object.keys(counts).map(name => ({ name, clients: counts[name] }));
  }, [fullCompletedList, barbers]);

  const barberRevenue = useMemo(() => {
    const revenues = barbers.reduce((acc, barber) => {
      acc[barber.name] = 0;
      return acc;
    }, {} as { [key: string]: number });
    fullCompletedList.forEach(entry => {
      if(entry.barbers?.name) {
        const entryTotal = entry.queue_entry_services?.reduce((sum, qes) => {
          return sum + (qes.services?.price || 0);
        }, 0) || 0;
        revenues[entry.barbers.name] = (revenues[entry.barbers.name] || 0) + entryTotal;
      }
    });
    return Object.keys(revenues).map(name => ({ name, revenue: revenues[name] }));
  }, [fullCompletedList, barbers]);

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
      alert("This client has no assigned barber and cannot be re-queued.");
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
      alert("Could not retrieve the current queue. Please try again.");
      return;
    }
    const newPosition = waitingEntries && waitingEntries.length > 0 ? waitingEntries[0].queue_position - 1 : 1;
    const { error: updateError } = await supabase
      .from('queue_entries')
      .update({ status: 'waiting', queue_position: newPosition })
      .eq('id', entry.id);

    if (updateError) {
      console.error("Error re-queuing client:", updateError);
      alert("Failed to re-queue the client.");
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: QueueEntry['status']) => {
    if (newStatus === 'done' && shop) {
      const { error: billableError } = await supabase
        .from('billable_events')
        .insert({ shop_id: shop.id, queue_entry_id: id });

      if (billableError) {
        console.error("Could not create billable event:", billableError);
        alert("Warning: Could not log this event for billing. Please contact support.");
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
      alert("Could not delete this entry.");
    }
  }

  const handleOpenEditDialog = (entry: QueueEntry) => {
    if (entry.barbers) {
      setEditingQueueEntry(entry);
      setEditedBarberId(entry.barbers.id);
      setIsEditQueueEntryDialogOpen(true);
    } else {
      alert("This entry has no barber assigned to edit.");
    }
  }

  const handleUpdateQueueEntry = async () => {
    if (!editingQueueEntry) return;
    
    const { error } = await supabase
      .from('queue_entries')
      .update({ barber_id: editedBarberId })
      .eq('id', editingQueueEntry.id);
    
    if (error) {
      alert(`Error updating barber: ${error.message}`);
      return;
    }
    setIsEditQueueEntryDialogOpen(false);
    setEditingQueueEntry(null);
  }

  // --- NEW: Updated handler to save opening/closing times ---
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
      alert(`Failed to update shop details: ${error.message}`);
      return;
    }
    if (updatedShop) setShop(updatedShop);
    alert("Shop details updated!");
  };
  const handleAddService = async () => {
    if (!shop || !newServiceName || !newServicePrice || !newServiceDuration) return;
    const { error } = await supabase.from('services').insert({ name: newServiceName, price: parseFloat(newServicePrice), duration_minutes: parseInt(newServiceDuration), shop_id: shop.id });
    if (!error) { 
      setNewServiceName(''); 
      setNewServicePrice(''); 
      setNewServiceDuration(''); 
    }
  };
  const handleDeleteService = async (serviceId: string) => {
    if (!confirm("Are you sure you want to delete this service?")) return;
    try {
      await supabase.from('services').delete().eq('id', serviceId).throwOnError();
    } catch (error) {
      console.error("Delete service error:", error);
      alert("Could not delete service. It may be linked to historical queue entries.");
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
        alert('Error uploading avatar. Please try again.');
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
    }
  };
  const handleDeleteBarber = async (barberId: string) => {
    if (!confirm("Are you sure you want to delete this barber?")) return;
    try {
      await supabase.from('barbers').delete().eq('id', barberId).throwOnError();
    } catch (error) {
      console.error("Delete barber error:", error);
      alert("Could not delete barber. They may be linked to historical queue entries.");
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
      alert('Could not generate QR code. Please try again.');
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
        alert(`Error creating billing portal: ${error.message}`);
      } else {
        alert('An unknown error occurred while creating the billing portal.');
      }
    }
  };

  if (loading) { return <div className="flex items-center justify-center h-screen"><p>Loading...</p></div> }
  if (!shop) { return <div className="p-8">Please create a shop to view the dashboard.</div> }

  const isTrial = shop.subscription_status === 'trial' || shop.subscription_status === null;
  const trialUsages = 100 - billableEventsCount;

  return (
    <>
      <div className="container mx-auto p-4 md:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-bold tracking-tight">{shop.name} - Live View</h1>
          <div className="flex items-center gap-2">
            <Link href={`/shop/${shop.id}`} target="_blank"><Button variant="outline">Join Queue</Button></Link>
            
            <Dialog open={isBillingDialogOpen} onOpenChange={setIsBillingDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Billing & Subscription</Button>
              </DialogTrigger>
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
              <DialogTrigger asChild><Button>Edit Shop</Button></DialogTrigger>
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
                      {/* --- NEW: Opening/Closing time inputs --- */}
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
                     <Table>
                        <TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Price</TableHead><TableHead></TableHead></TableRow></TableHeader>
                        <TableBody>
                          {services.map(s => <TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell>${s.price}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => handleDeleteService(s.id)}><Trash2 className="h-4 w-4" /></Button></TableCell></TableRow>)}
                        </TableBody>
                     </Table>
                   </CardContent>
                   <CardFooter className="flex gap-2 items-end">
                      <div className="grid gap-1.5 flex-grow"><Label htmlFor="new-service-name">New Service</Label><Input id="new-service-name" placeholder="Name" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} /></div>
                      <div className="grid gap-1.5 w-24"><Label htmlFor="new-service-price">Price</Label><Input id="new-service-price" type="number" placeholder="$" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)} /></div>
                      <div className="grid gap-1.5 w-24"><Label htmlFor="new-service-duration">Mins</Label><Input id="new-service-duration" type="number" placeholder="Time" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)} /></div>
                      <Button onClick={handleAddService}>Add</Button>
                   </CardFooter>
                 </Card>
                 <Card>
                   <CardHeader><CardTitle>Manage Barbers</CardTitle></CardHeader>
                   <CardContent>
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
                              <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => handleDeleteBarber(b.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                     </Table>
                   </CardContent>
                   <CardFooter className="flex flex-col gap-4 items-start">
                      <div className="grid gap-1.5 w-full">
                        <Label htmlFor="new-barber-name">New Barber Name</Label>
                        <Input id="new-barber-name" placeholder="e.g., John Smith" value={newBarberName} onChange={e => setNewBarberName(e.target.value)} /></div>
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
            <Button variant="ghost" size="sm" onClick={handleLogout}>Logout</Button>
          </div>
        </header>

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
              {fullCompletedList.length > 10 && !showAllCompleted && (
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
              {fullNoShowList.length > 10 && !showAllNoShows && (
                 <Button variant="link" className="w-full mt-4" onClick={() => setShowAllNoShows(true)}>
                  See all {fullNoShowList.length}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 xl:col-span-3">
          <h2 className="text-2xl font-bold tracking-tight mb-4">Today&apos;s Analytics</h2>
          <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Revenue per Barber</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={barberRevenue} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(value) => `$${value}`} />
                    <YAxis type="category" dataKey="name" width={80} />
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Bar dataKey="revenue" name="Total Revenue">
                      {barberRevenue.map((entry) => (
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
                            data={barberClientCount}
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
                            {barberClientCount.map((entry) => (
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
        </div>

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
