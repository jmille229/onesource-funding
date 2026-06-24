import TopBar from "@/components/TopBar";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import GovernmentBanner from "@/components/GovernmentBanner";
import InfoCards from "@/components/InfoCards";
import GetStartedSection from "@/components/GetStartedSection";
import TestimonialsCarousel from "@/components/TestimonialsCarousel";
import StatsSection from "@/components/StatsSection";
import DifferenceSection from "@/components/DifferenceSection";
import ProcessSteps from "@/components/ProcessSteps";
import LocationsSection from "@/components/LocationsSection";
import BlogSection from "@/components/BlogSection";
import CtaBanner from "@/components/CtaBanner";
import Footer from "@/components/Footer";

const Index = () => (
  <div className="min-h-screen">
    <TopBar />
    <Navbar />
    <main>
      <HeroSection />
      <GovernmentBanner />
      <InfoCards />
      <GetStartedSection />
      <TestimonialsCarousel />
      <StatsSection />
      <DifferenceSection />
      <ProcessSteps />
      <LocationsSection />
      <BlogSection />
      <CtaBanner />
    </main>
    <Footer />
  </div>
);

export default Index;
