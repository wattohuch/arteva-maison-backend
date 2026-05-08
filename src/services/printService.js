/**
 * ARTEVA Maison - Auto-Print Service
 * Pixel-perfect match of receipt.html at 300 DPI
 */
const http = require('http');
const https = require('https');
const { createCanvas } = require('canvas');
const QRCode = require('qrcode');

const DPI = 300;
const W = Math.round(8.27 * DPI);
const H = Math.round(11.69 * DPI);
const S = DPI / 72; // scale factor
const f = pt => Math.round(pt * S);

const GOLD = '#D4AF37', DARK = '#2c241b', MID = '#666666', LIGHT = '#999999';
const BORDER = '#e6e1d6', BG = '#fafaf8';

// ── Helpers ──
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();}
function wrap(c,t,x,y,mw,lh){const w=t.split(' ');let l='',cy=y;w.forEach(word=>{const test=l+word+' ';if(c.measureText(test).width>mw&&l!==''){c.fillText(l.trim(),x,cy);l=word+' ';cy+=lh;}else l=test;});c.fillText(l.trim(),x,cy);return cy;}
function trunc(c,t,mw){if(c.measureText(t).width<=mw)return t;let s=t;while(c.measureText(s+'…').width>mw&&s.length>0)s=s.slice(0,-1);return s+'…';}

async function generateQR(url, size) {
    const qc = createCanvas(size, size);
    await QRCode.toCanvas(qc, url, { width: size, margin: 1, color: { dark: '#2c241b', light: '#fff' }, errorCorrectionLevel: 'H' });
    const c = qc.getContext('2d');
    c.strokeStyle = GOLD; c.lineWidth = Math.round(size*0.025); c.strokeRect(0,0,size,size);
    const ls = Math.round(size*0.2);
    c.fillStyle='#fff';c.beginPath();c.arc(size/2,size/2,ls*0.7,0,Math.PI*2);c.fill();
    c.strokeStyle=GOLD;c.lineWidth=Math.round(size*0.012);c.beginPath();c.arc(size/2,size/2,ls*0.7,0,Math.PI*2);c.stroke();
    c.fillStyle=GOLD;c.font=`bold ${ls}px serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('A',size/2,size/2+ls*0.05);
    return qc;
}

// ── Main Renderer ──
async function renderReceiptToJpeg(order, customer) {
    const canvas = createCanvas(W, H);
    const c = canvas.getContext('2d');
    c.fillStyle='#fff'; c.fillRect(0,0,W,H);
    
    let y = f(18);
    const LM = f(18), RM = W-f(18), CW = RM-LM;
    c.textBaseline = 'top';

    // ═══ HEADER ═══
    c.fillStyle=DARK; c.font=`bold ${f(24)}px Georgia`; c.textAlign='center';
    c.fillText('ARTÉVA MAISON', W/2, y); y += f(28);
    c.font=`${f(9)}px Arial`; c.fillStyle=MID; c.letterSpacing='2px';
    c.fillText('Order Receipt', W/2, y); y += f(12);
    c.font=`${f(9)}px Arial`; c.fillText('إيصال الطلب', W/2, y); y += f(14);
    c.strokeStyle=GOLD; c.lineWidth=f(1.2); c.beginPath(); c.moveTo(LM,y); c.lineTo(RM,y); c.stroke(); y+=f(12);

    // ═══ ORDER META (3 columns) ═══
    const orderDate = new Date(order.createdAt||Date.now()).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
    const status = (order.orderStatus||'pending').replace(/_/g,' ');
    const statusColor = ['confirmed','delivered'].includes(order.orderStatus)?'#065f46':['cancelled'].includes(order.orderStatus)?'#991b1b':'#92400e';
    const statusBg = ['confirmed','delivered'].includes(order.orderStatus)?'#d1fae5':['cancelled'].includes(order.orderStatus)?'#fee2e2':'#fef3c7';

    const metas = [
        {en:'Order Number',ar:'رقم الطلب',val:order.orderNumber||'N/A'},
        {en:'Date',ar:'التاريخ',val:orderDate},
        {en:'Order Status',ar:'حالة الطلب',val:status,badge:true}
    ];
    const mw = CW/3;
    c.textAlign='left';
    metas.forEach((m,i)=>{
        const x=LM+i*mw;
        c.fillStyle=MID; c.font=`${f(8)}px Arial`; c.fillText(m.en, x, y);
        c.fillStyle=LIGHT; c.font=`${f(7)}px Arial`; c.fillText(m.ar, x, y+f(10));
        if(m.badge){
            c.fillStyle=statusBg; const bw=c.measureText(m.val).width+f(8);
            rr(c,x,y+f(16),bw+f(4),f(12),f(5)); c.fill();
            c.fillStyle=statusColor; c.font=`600 ${f(9)}px Arial`; c.fillText(m.val, x+f(4), y+f(18));
        } else {
            c.fillStyle=DARK; c.font=`500 ${f(11)}px Arial`; c.fillText(m.val, x, y+f(18));
        }
    });
    y += f(36);

    // ═══ CUSTOMER & SHIPPING GRID ═══
    const gH = f(58), gW = (CW-f(10))/2, gR = f(4), gP = f(8);
    c.fillStyle=BG; rr(c,LM,y,CW,gH,gR); c.fill();
    c.strokeStyle=BORDER; c.lineWidth=f(0.5); rr(c,LM,y,CW,gH,gR); c.stroke();
    // vertical divider
    c.beginPath(); c.moveTo(LM+gW+f(5),y+gP); c.lineTo(LM+gW+f(5),y+gH-gP); c.stroke();

    const custName = customer?customer.name:(order.shippingAddress?.fullName||'Guest');
    const custEmail = customer?customer.email:'';
    const custPhone = customer?(customer.phone||''):(order.shippingAddress?.phone||'');
    
    // Left: Customer
    c.fillStyle=MID; c.font=`${f(8)}px Arial`; c.fillText('Customer Details', LM+gP, y+gP);
    c.fillStyle=LIGHT; c.font=`${f(6.5)}px Arial`; c.fillText('بيانات العميل', LM+gP+c.measureText('Customer Details ').width, y+gP+f(1));
    c.fillStyle=DARK; c.font=`600 ${f(10)}px Arial`; c.fillText(custName, LM+gP, y+f(20));
    c.fillStyle=MID; c.font=`${f(8.5)}px Arial`; c.fillText(custEmail, LM+gP, y+f(31));
    c.fillText(custPhone, LM+gP, y+f(41));

    // Right: Shipping
    const sx = LM+gW+f(15);
    const addr = order.shippingAddress||{};
    c.fillStyle=MID; c.font=`${f(8)}px Arial`; c.fillText('Shipping Address', sx, y+gP);
    c.fillStyle=LIGHT; c.font=`${f(6.5)}px Arial`; c.fillText('عنوان الشحن', sx+c.measureText('Shipping Address ').width, y+gP+f(1));
    c.fillStyle=MID; c.font=`${f(8.5)}px Arial`;
    const addrLines = [addr.street, [addr.city,addr.state,addr.zipCode].filter(Boolean).join(', '), addr.country].filter(Boolean);
    let ay = y+f(20);
    addrLines.forEach(l=>{c.fillText(l,sx,ay);ay+=f(11);});
    y += gH+f(10);

    // ═══ PAYMENT GRID ═══
    const payH = f(38);
    c.fillStyle=BG; rr(c,LM,y,CW,payH,gR); c.fill();
    c.strokeStyle=BORDER; c.lineWidth=f(0.5); rr(c,LM,y,CW,payH,gR); c.stroke();
    c.beginPath(); c.moveTo(LM+gW+f(5),y+gP); c.lineTo(LM+gW+f(5),y+payH-gP); c.stroke();

    const payNames = {'cod':'Cash on Delivery','knet':'KNET','card':'Credit/Debit Card','applepay':'Apple Pay','myfatoorah':'Online Payment'};
    c.fillStyle=MID; c.font=`${f(8)}px Arial`; c.fillText('Payment Method', LM+gP, y+gP);
    c.fillStyle=LIGHT; c.font=`${f(6.5)}px Arial`; c.fillText('طريقة الدفع', LM+gP+c.measureText('Payment Method ').width, y+gP+f(1));
    c.fillStyle=DARK; c.font=`500 ${f(10)}px Arial`; c.fillText((payNames[order.paymentMethod]||order.paymentMethod||'N/A').toUpperCase(), LM+gP, y+f(22));

    c.fillStyle=MID; c.font=`${f(8)}px Arial`; c.fillText('Payment Status', sx, y+gP);
    c.fillStyle=LIGHT; c.font=`${f(6.5)}px Arial`; c.fillText('حالة الدفع', sx+c.measureText('Payment Status ').width, y+gP+f(1));
    const ps = (order.paymentStatus||'pending').replace(/_/g,' ');
    const psBg = order.paymentStatus==='paid'?'#d1fae5':order.paymentStatus==='failed'?'#fee2e2':'#fef3c7';
    const psColor = order.paymentStatus==='paid'?'#065f46':order.paymentStatus==='failed'?'#991b1b':'#92400e';
    c.font=`600 ${f(9)}px Arial`; const psW=c.measureText(ps).width;
    c.fillStyle=psBg; rr(c,sx,y+f(19),psW+f(8),f(12),f(5)); c.fill();
    c.fillStyle=psColor; c.fillText(ps, sx+f(4), y+f(21));
    y += payH+f(10);

    // ═══ ITEMS TABLE ═══
    const items = order.items||[];
    const colHeaders = [
        {en:'SKU',ar:'رقم'},{en:'Item',ar:'المنتج'},{en:'Unit Price',ar:'السعر'},{en:'Qty',ar:'الكمية'},{en:'Total',ar:'المجموع'}
    ];
    const cols = [{w:f(50)},{w:0},{w:f(80)},{w:f(45),a:'center'},{w:f(90),a:'right'}];
    cols[1].w = CW - cols[0].w - cols[2].w - cols[3].w - cols[4].w;
    let cx = LM;
    cols.forEach(col=>{col.x=cx; cx+=col.w;});

    // Table header line
    c.strokeStyle=BORDER; c.lineWidth=f(0.5);
    c.beginPath(); c.moveTo(LM,y+f(15)); c.lineTo(RM,y+f(15)); c.stroke();
    // Draw EN then AR for each header
    colHeaders.forEach((h,i)=>{
        const col=cols[i];
        const tx = col.a==='right'?col.x+col.w:col.a==='center'?col.x+col.w/2:col.x;
        c.textAlign=col.a||'left';
        c.fillStyle=DARK; c.font=`${f(9)}px Georgia`;
        c.fillText(h.en, tx, y+f(1));
        // Arabic label on second line
        c.fillStyle=LIGHT; c.font=`${f(7)}px Arial`;
        c.fillText(h.ar, tx, y+f(10));
    });
    y += f(20);

    // Rows
    items.forEach(item=>{
        const sku=item.sku||'—', total=(item.price*item.quantity).toFixed(3);
        c.textAlign='left';
        c.fillStyle=MID; c.font=`${f(8.5)}px Courier New`; c.fillText(sku, cols[0].x, y);
        c.fillStyle=DARK; c.font=`500 ${f(9.5)}px Arial`; c.fillText(trunc(c,item.name||'Product',cols[1].w-f(4)), cols[1].x, y);
        if(item.nameAr){c.fillStyle=LIGHT;c.font=`${f(7.5)}px Arial`;c.fillText(item.nameAr,cols[1].x,y+f(11));}
        if(item.variant){c.fillStyle=LIGHT;c.font=`${f(7)}px Arial`;c.fillText(item.variant,cols[1].x,y+f(item.nameAr?19:11));}
        c.fillStyle=DARK; c.font=`${f(9)}px Arial`;
        c.textAlign='left'; c.fillText(item.price.toFixed(3)+' KWD', cols[2].x, y);
        c.textAlign='center'; c.fillText(String(item.quantity), cols[3].x+cols[3].w/2, y);
        c.textAlign='right'; c.fillText(total+' KWD', cols[4].x+cols[4].w, y);
        y += item.nameAr?f(26):f(20);
        c.strokeStyle=BORDER; c.lineWidth=f(0.3); c.beginPath(); c.moveTo(LM,y); c.lineTo(RM,y); c.stroke();
        y += f(6);
    });
    y += f(8);

    // ═══ TOTALS ═══
    const tw = f(200), tx = RM-tw;
    // Subtotal
    c.textAlign='left'; c.font=`${f(9.5)}px Arial`; c.fillStyle=DARK;
    c.fillText('Subtotal', tx, y);
    c.fillStyle=LIGHT; c.font=`${f(7.5)}px Arial`;
    c.fillText('/ المجموع الفرعي', tx+f(52), y+f(1.5));
    c.fillStyle=DARK; c.font=`${f(9.5)}px Arial`;
    c.textAlign='right'; c.fillText((order.subtotal||0).toFixed(3)+' KWD', RM, y); y+=f(14);
    // Delivery
    c.textAlign='left'; c.fillText('Delivery', tx, y);
    c.fillStyle=LIGHT; c.font=`${f(7.5)}px Arial`;
    c.fillText('/ التوصيل', tx+f(48), y+f(1.5));
    c.fillStyle=DARK; c.font=`${f(9.5)}px Arial`;
    c.textAlign='right'; c.fillText((order.shippingCost||0).toFixed(3)+' KWD', RM, y); y+=f(12);
    // Divider
    c.strokeStyle=BORDER; c.lineWidth=f(1); c.beginPath(); c.moveTo(tx,y); c.lineTo(RM,y); c.stroke(); y+=f(14);
    // Total Paid
    c.textAlign='left'; c.font=`bold ${f(13)}px Arial`; c.fillStyle=DARK;
    c.fillText('Total Paid', tx, y);
    c.fillStyle=LIGHT; c.font=`bold ${f(9)}px Arial`;
    c.fillText('/ المبلغ المدفوع', tx+f(78), y+f(3));
    c.fillStyle=DARK; c.font=`bold ${f(13)}px Arial`;
    c.textAlign='right'; c.fillText((order.total||0).toFixed(3)+' KWD', RM, y); y+=f(24);

    // ═══ QR CODE ═══
    const qrSz=f(60), qrH=qrSz+f(14);
    c.fillStyle=BG; rr(c,LM,y,CW,qrH,f(5)); c.fill();
    c.strokeStyle=BORDER; c.lineWidth=f(0.5); rr(c,LM,y,CW,qrH,f(5)); c.stroke();
    try{
        const qrUrl='https://www.artevamaisonkw.com/receipt.html?order='+(order.orderNumber||'');
        const qrC=await generateQR(qrUrl,qrSz);
        const qrX=LM+f(10), qrY=y+(qrH-qrSz)/2;
        c.drawImage(qrC,qrX,qrY,qrSz,qrSz);
        const lx=qrX+qrSz+f(14);
        c.textAlign='left'; c.fillStyle=DARK; c.font=`600 ${f(10)}px Arial`;
        c.fillText('Scan for Digital Receipt', lx, y+f(20));
        c.fillStyle=MID; c.font=`${f(8.5)}px Arial`;
        c.fillText('امسح للإيصال الرقمي', lx, y+f(32));
        c.fillStyle=LIGHT; c.font=`${f(8)}px Arial`;
        c.fillText('www.artevamaisonkw.com', lx, y+f(46));
    }catch(e){console.error('[PRINT] QR error:',e.message);}
    y+=qrH+f(10);

    // ═══ RETURN POLICY ═══
    const rpH=f(78);
    c.fillStyle='#fffbeb'; rr(c,LM,y,CW,rpH,f(4)); c.fill();
    c.strokeStyle='rgba(245,158,11,0.2)'; c.lineWidth=f(0.5); rr(c,LM,y,CW,rpH,f(4)); c.stroke();
    c.fillStyle=GOLD; c.fillRect(LM,y,f(2),rpH); // gold left bar

    const rpX=LM+f(10);
    // EN title left, AR title right
    c.textAlign='left'; c.fillStyle=DARK;
    c.font=`${f(11)}px Georgia`; c.fillText('Return & Exchange Policy', rpX, y+f(8));
    c.textAlign='right'; c.font=`600 ${f(10)}px Arial`;
    c.fillText('سياسة الإرجاع والاستبدال', RM-f(10), y+f(9));
    // EN policy text
    c.textAlign='left'; c.fillStyle=MID; c.font=`${f(8)}px Arial`;
    c.fillText('Products may be returned or exchanged within 14 days of delivery, provided they are', rpX, y+f(24));
    c.fillText('unopened and in their original condition and packaging.', rpX, y+f(33));
    // AR policy text (right-aligned)
    c.textAlign='right';
    c.fillText('يمكن إرجاع أو استبدال المنتجات خلال ١٤ يومًا من التسليم، بشرط أن تكون غير مفتوحة وفي حالتها وتغليفها الأصلي', RM-f(10), y+f(46));
    // Contact
    c.textAlign='left';
    c.fillText('Contact us via WhatsApp: +965 5068 3207', rpX, y+f(60));
    c.textAlign='right';
    c.fillText('تواصلوا معنا عبر واتساب: ٩٦٥٥٠٦٨٣٢٠٧+', RM-f(10), y+f(60));
    y+=rpH+f(10);

    // ═══ FOOTER ═══
    c.strokeStyle=BORDER; c.lineWidth=f(0.5); c.beginPath(); c.moveTo(LM,y); c.lineTo(RM,y); c.stroke(); y+=f(10);
    c.textAlign='center'; c.fillStyle=MID; c.font=`${f(9)}px Arial`;
    c.fillText('Thank you for shopping with ARTÉVA Maison.', W/2, y); y+=f(12);
    c.fillText('شكراً لتسوقكم مع أرتيفا ميزون', W/2, y); y+=f(12);
    c.fillStyle=LIGHT; c.font=`${f(8)}px Arial`;
    c.fillText('artevamaison@gmail.com • www.artevamaisonkw.com • +965 5068 3207', W/2, y);

    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

// ── IPP Protocol ──
function ippAttr(t,n,v){const nb=Buffer.from(n,'utf-8'),vb=Buffer.from(v,'utf-8'),b=Buffer.alloc(1+2+nb.length+2+vb.length);let o=0;b.writeUInt8(t,o);o++;b.writeUInt16BE(nb.length,o);o+=2;nb.copy(b,o);o+=nb.length;b.writeUInt16BE(vb.length,o);o+=2;vb.copy(b,o);return b;}
function ippInt(t,n,v){const nb=Buffer.from(n,'utf-8'),b=Buffer.alloc(1+2+nb.length+2+4);let o=0;b.writeUInt8(t,o);o++;b.writeUInt16BE(nb.length,o);o+=2;nb.copy(b,o);o+=nb.length;b.writeUInt16BE(4,o);o+=2;b.writeInt32BE(v,o);return b;}

function buildIppPrintJob(jpeg, name) {
    const a=[Buffer.from([0x01]),ippAttr(0x47,'attributes-charset','utf-8'),ippAttr(0x48,'attributes-natural-language','en'),ippAttr(0x45,'printer-uri','ipp://localhost/ipp/print'),ippAttr(0x49,'document-format','image/jpeg'),ippAttr(0x42,'job-name',name||'Receipt'),Buffer.from([0x02]),ippInt(0x21,'copies',1),Buffer.from([0x03])];
    const h=Buffer.alloc(8);h.writeUInt8(2,0);h.writeUInt8(0,1);h.writeUInt16BE(0x0002,2);h.writeUInt32BE(Math.floor(Math.random()*0xFFFF),4);
    return Buffer.concat([h,...a,jpeg]);
}

function sendIpp(url, data) {
    return new Promise((res,rej)=>{
        const u=new URL(url),cl=u.protocol==='https:'?https:http;
        const r=cl.request({hostname:u.hostname,port:u.port||631,path:u.pathname||'/ipp/print',method:'POST',headers:{'Content-Type':'application/ipp','Content-Length':data.length},timeout:60000},resp=>{
            const ch=[];resp.on('data',c=>ch.push(c));resp.on('end',()=>{const b=Buffer.concat(ch);if(b.length>=4){const s=b.readUInt16BE(2);res({success:s<=0xFF,statusCode:`0x${s.toString(16).padStart(4,'0')}`,message:s<=0xFF?'OK':`IPP error 0x${s.toString(16)}`});}else res({success:true});});
        });r.on('error',rej);r.on('timeout',()=>{r.destroy();rej(new Error('timeout'));});r.write(data);r.end();
    });
}

// ── Public API ──
async function autoPrintReceipt(order, customer) {
    const url = process.env.PRINTER_IPP_URL;
    if (!url) { console.log('[PRINT] PRINTER_IPP_URL not set'); return { success: false }; }
    try {
        console.log(`[PRINT] 🖨️ Rendering receipt ${order.orderNumber}...`);
        const jpeg = await renderReceiptToJpeg(order, customer);
        console.log(`[PRINT] 📄 ${(jpeg.length/1024).toFixed(0)} KB @ 300 DPI`);
        const ipp = buildIppPrintJob(jpeg, `Receipt-${order.orderNumber}`);
        const r = await sendIpp(url, ipp);
        console.log(`[PRINT] ${r.success?'✅':'❌'} ${r.statusCode||''} ${r.message||''}`);
        return r;
    } catch(e) { console.error(`[PRINT] ❌ ${e.message}`); return { success:false, error:e.message }; }
}

async function printExistingOrderReceipt(orderId) {
    const Order = require('../models/Order');
    const order = await Order.findById(orderId).populate('user','name email phone').lean();
    if(!order) return {success:false,error:'Not found'};
    return autoPrintReceipt(order, order.user);
}

module.exports = { autoPrintReceipt, printExistingOrderReceipt, renderReceiptToJpeg };
