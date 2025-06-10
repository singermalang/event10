import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import QRCode from 'qrcode'
import db from '@/lib/db'
import { generateSlug } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    
    const name = formData.get('name') as string
    const type = formData.get('type') as string
    const location = formData.get('location') as string
    const description = formData.get('description') as string
    const startTime = formData.get('startTime') as string
    const endTime = formData.get('endTime') as string
    const quota = parseInt(formData.get('quota') as string)
    const ticketDesignFile = formData.get('ticketDesign') as File | null

    if (!name || !type || !location || !startTime || !endTime || !quota) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 })
    }

    // Generate slug
    const slug = generateSlug(name)

    // Handle ticket design upload
    let ticketDesignPath = null
    if (ticketDesignFile && ticketDesignFile.size > 0) {
      const bytes = await ticketDesignFile.arrayBuffer()
      const buffer = Buffer.from(bytes)
      
      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
      await mkdir(uploadsDir, { recursive: true })
      
      const filename = `ticket-${Date.now()}-${ticketDesignFile.name}`
      const filepath = path.join(uploadsDir, filename)
      await writeFile(filepath, buffer)
      ticketDesignPath = `/uploads/${filename}`
    }

    // Insert event into database
    const [result] = await db.execute(
      'INSERT INTO events (name, slug, type, location, description, start_time, end_time, quota, ticket_design) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, slug, type, location, description, startTime, endTime, quota, ticketDesignPath]
    )

    const eventId = (result as any).insertId

    // Generate tickets
    const ticketsDir = path.join(process.cwd(), 'public', 'tickets')
    await mkdir(ticketsDir, { recursive: true })

    for (let i = 0; i < quota; i++) {
      const token = uuidv4().replace(/-/g, '').substring(0, 12).toUpperCase()
      const registrationUrl = `${process.env.SERVER_URL || 'http://10.10.11.28:3000'}/register?token=${token}`
      
      // Generate QR code
      const qrCodeBuffer = await QRCode.toBuffer(registrationUrl)
      const qrCodePath = path.join(ticketsDir, `qr_${token}.png`)
      await writeFile(qrCodePath, qrCodeBuffer)
      
      // Insert ticket into database
      await db.execute(
        'INSERT INTO tickets (event_id, token, qr_code_url, is_verified) VALUES (?, ?, ?, ?)',
        [eventId, token, `/tickets/qr_${token}.png`, false]
      )
    }

    return NextResponse.json({ 
      message: 'Event created successfully',
      eventId: eventId,
      ticketsGenerated: quota
    })
  } catch (error) {
    console.error('Error creating event:', error)
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const [rows] = await db.execute(`
      SELECT e.*, 
             COUNT(t.id) as total_tickets,
             COUNT(CASE WHEN t.is_verified = TRUE THEN 1 END) as verified_tickets
      FROM events e
      LEFT JOIN tickets t ON e.id = t.event_id
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `)
    
    return NextResponse.json(rows)
  } catch (error) {
    console.error('Error fetching events:', error)
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 })
  }
}